"""Build progress, dashboard, budget and Ask the project. Run: bench --site <site> run-tests --app mimaar"""

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import add_days, flt, nowdate

from mimaar import askai, build, dash, money
from mimaar.tests.test_procurement import a_file

ASK_AI = "/opt/bench/fake_ask.json"


def stage(code="T9", days_ago=10, length=20):
	project = frappe.db.get_single_value("Mimaar Settings", "default_project")
	subj = f"{code} Test stage {frappe.generate_hash(length=4)}"
	return frappe.get_doc({"doctype": "Task", "subject": subj, "project": project, "exp_start_date": add_days(nowdate(), -days_ago),
		"exp_end_date": add_days(nowdate(), length - days_ago), "status": "Open", "mimaar_phase": "Grey structure", "task_weight": 1}).insert()


class TestStage3(IntegrationTestCase):
	def setUp(self):
		frappe.set_user("Administrator")

	def tearDown(self):
		frappe.set_user("Administrator")
		frappe.local.conf.pop("mimaar_fake_ai_file", None)

	def test_report_verify_and_figures(self):
		t = stage()
		rows = {r["name"]: r for r in build._stage_rows()}
		self.assertAlmostEqual(rows[t.name]["planned"], 50, delta=1)  # 10 of 20 days
		with self.assertRaises(frappe.ValidationError):
			build.report(t.name, 30)  # more work needs a photo
		build.report(t.name, 30, "Columns cast", [a_file("p1.png")])
		t.reload()
		self.assertEqual(flt(t.mimaar_reported), 30)
		self.assertEqual(flt(t.progress), 30)
		self.assertEqual(t.status, "Working")
		r = {x["name"]: x for x in build._stage_rows()}[t.name]
		self.assertEqual(r["state"], "behind")  # 30 built, 50 planned
		build.verify(t.name, 25, "Checked on site", [a_file("v1.png")])
		t.reload()
		self.assertEqual(flt(t.progress), 25)  # the owner's figure counts once it is there
		self.assertTrue(t.mimaar_verified_on)
		build.report(t.name, 40, "More", [a_file("p2.png")])
		t.reload()
		self.assertEqual(flt(t.progress), 25)
		build.verify(t.name, 100)
		t.reload()
		self.assertEqual(t.status, "Completed")
		d = build.stage(t.name)
		self.assertEqual(len(d["updates"]), 4)
		self.assertEqual(len(build._photos([t.name], per=9)[t.name]), 3)
		s = build.stages()
		self.assertTrue(s["phases"] and "built" in s)

	def test_only_owner_side_verifies(self):
		t = stage("T8")
		sup = frappe.db.get_value("Site Worker", {"user": ["is", "set"], "app_access": "Site supervisor", "status": "Active"}, "user")
		if not sup:
			return
		frappe.set_user(sup)
		build.report(t.name, 10, None, [a_file("x.png")])
		with self.assertRaises(frappe.PermissionError):
			build.verify(t.name, 10)
		with self.assertRaises(frappe.PermissionError):
			money.budget_overview()

	def test_dashboard_and_budget(self):
		d = dash.overview()
		self.assertIn("photos", d["tiles"])
		self.assertTrue(d["money"])
		self.assertIn("budget", d["panels"])
		b = money.budget_overview()
		self.assertAlmostEqual(b["budget"], sum(p["budget"] for p in b["phases"]), delta=1)
		self.assertTrue(b["cash"]["months"])
		self.assertAlmostEqual(sum(b["cash"]["projected"]) + sum(b["cash"]["scheduled"]), b["total_projected"], delta=len(b["cash"]["months"]) + 1)
		acc = money.budget_line_add("Test solar panels " + frappe.generate_hash(length=4), "Finishing materials", 250000)
		self.assertEqual(frappe.db.get_value("Account", acc, "mimaar_budget_category"), "Finishing materials")
		line = money.budget_line(acc)
		self.assertEqual(line["line"]["budget"], 250000)
		self.assertEqual(line["line"]["phase"], "Finishing")

	def test_ask_the_project(self):
		frappe.local.conf["mimaar_fake_ai_file"] = ASK_AI
		r = askai.ask("Are we on schedule?")
		self.assertIn("Owner brief", r["answer"])
		self.assertEqual(len(r["followups"]), 2)
		prompt = frappe.local.mimaar_last_prompt
		self.assertIn('"schedule"', prompt)
		self.assertIn('"budget"', prompt)  # the owner sees money
		data = askai.gather(False)
		self.assertNotIn("budget", data)
		self.assertNotIn("total", (data["purchase_orders"] or [{}])[0])

	def test_partner_and_owner_supervisor(self):
		from mimaar import field, petty, stores
		from mimaar.tests.test_identity import person

		pt = person("Partner Test Builder", worker_type="Supervisor")
		pt.app_access = "Partner (builder or consultant)"
		pt.save()
		user = frappe.db.get_value("Site Worker", pt.name, "user")
		self.assertIn("Mimaar Partner", frappe.get_roles(user))
		os_ = person("Owner Sup Test", worker_type="Supervisor")
		os_.app_access = "Owner's supervisor"
		os_.save()
		ou = frappe.db.get_value("Site Worker", os_.name, "user")
		t = stage("T7")
		frappe.set_user(user)
		c = field.caps()
		self.assertTrue(c["partner"] and c["site"])
		self.assertFalse(c["store"] or c["money"] or c["people"])
		build.report(t.name, 10, "Shuttering fixed", [a_file("pt.png")])
		with self.assertRaises(frappe.PermissionError):
			stores.items()
		with self.assertRaises(frappe.PermissionError):
			petty.overview()
		with self.assertRaises(frappe.PermissionError):
			build.verify(t.name, 10)
		d = dash.overview()
		self.assertNotIn("stock", d["tiles"])
		self.assertFalse(d["money"])
		frappe.set_user(ou)
		self.assertFalse(field.caps()["partner"])
		build.verify(t.name, 8, "Checked")
		self.assertEqual(flt(frappe.db.get_value("Task", t.name, "progress")), 8)

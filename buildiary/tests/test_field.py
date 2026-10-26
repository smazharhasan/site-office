"""The field app's server side (buildiary.field) and its page (/field): the same rules as ERPNext,
reached through simple calls. Run with: bench --site <site> run-tests --app buildiary"""

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import nowdate

from buildiary import field
from buildiary.tests.test_procurement import a_file, item, warehouse


class TestField(IntegrationTestCase):
	def test_boot_and_screens(self):
		b = field.boot()
		self.assertTrue(b["caps"]["owner"])
		self.assertIn(b["lang"], ("en", "ur"))
		d = field.dashboard()
		self.assertIn("kpi", d)
		self.assertIsInstance(d["acts"], list)
		for fn in (field.tasks, field.diary, field.inspections, field.stock, field.to_receive, field.movements, field.workers, field.suppliers, field.quotations, field.orders, field.bills, field.budget):
			fn()
		self.assertEqual(field.search("x"), {})
		self.assertIn("suppliers", field.search("ab"))

	def test_diary_snag_and_worker(self):
		name = field.diary_save({"work_done": "Test work", "weather": "Sunny", "photos": [a_file("d.png")]})
		self.assertEqual(frappe.db.get_value("Site Diary", name, "work_done"), "Test work")
		s = field.snag_save({"description": "Crack in plaster", "photo": a_file("s.png")})
		field.snag_save({"name": s, "status": "Fixed", "fixed_photo": a_file("f.png"), "note": "patched"})
		self.assertEqual(frappe.db.get_value("Site Snag", s, "status"), "Fixed")
		w = field.worker_save({"full_name": "Field Test Worker", "trade": "Mason", "cnic": "4210" + str(frappe.utils.random_string(9).__hash__() % 10**9).zfill(9)})
		self.assertTrue(frappe.db.exists("Site Worker", w["name"]))
		self.assertTrue(w["warnings"])  # police verification not done

	def test_release_needs_a_name(self):
		code = item("FIELD-TEST-CEMENT", "Bag")
		with self.assertRaises(frappe.ValidationError):
			field.release([{"item_code": code, "qty": 0}], issued_to="Ustad")

	def test_page(self):
		from buildiary.www import field as page

		ctx = frappe._dict()
		page.get_context(ctx)
		self.assertIn('"boot"', ctx.boot_json)
		self.assertNotIn("</script", ctx.boot_json + ctx.ur_json)
		ur = frappe.parse_json(ctx.ur_json)
		self.assertEqual(ur.get("Receive goods"), "سامان وصول کریں")
		self.assertEqual(ur.get("Hello, {0}"), "السلام علیکم، {0}")

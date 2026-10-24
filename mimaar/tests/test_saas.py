"""Mabni Cloud: plan state, payments, limits and sign-up checks. Run: bench --site <site> run-tests --app mimaar --module mimaar.tests.test_saas"""

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import add_days, getdate, nowdate

from mimaar.saas import common, signup, tenant


class TestSaas(IntegrationTestCase):
	def setUp(self):
		frappe.set_user("Administrator")
		self._conf = {k: frappe.local.conf.get(k) for k in ("mabni_control", "mabni")}
		frappe.local.conf["mabni_control"] = 1
		s = frappe.get_single("Mabni Settings")
		self._base = s.base_domain
		if not s.base_domain:
			s.base_domain = "example.test"
			s.save()
		for p in (("Owner", 15, 150), ("Builder", 49, 490)):
			if not frappe.db.exists("Mabni Plan", p[0]):
				frappe.get_doc({"doctype": "Mabni Plan", "plan_name": p[0], "mode": p[0], "price_month_usd": p[1], "price_year_usd": p[2], "max_projects": 2, "max_users": 10}).insert()

	def tearDown(self):
		for k, v in self._conf.items():
			if v is None:
				frappe.local.conf.pop(k, None)
			else:
				frappe.local.conf[k] = v

	def test_state(self):
		today = getdate(nowdate())
		st = tenant.state({"trial_ends": str(add_days(today, 3)), "grace_days": 3})
		self.assertEqual((st["status"], st["days_left"], st["blocked"]), ("Trial", 3, False))
		st = tenant.state({"trial_ends": str(add_days(today, -2)), "grace_days": 3})
		self.assertEqual((st["status"], st["blocked"]), ("Payment due", False))
		st = tenant.state({"trial_ends": str(add_days(today, -4)), "grace_days": 3})
		self.assertEqual((st["status"], st["blocked"]), ("Suspended", True))
		st = tenant.state({"trial_ends": str(add_days(today, -40)), "paid_until": str(add_days(today, 20)), "grace_days": 3})
		self.assertEqual((st["status"], st["blocked"]), ("Active", False))
		self.assertTrue(tenant.state({"status": "Suspended", "paid_until": str(add_days(today, 20))})["blocked"])
		self.assertFalse(tenant.state({"internal": 1, "status": "Suspended"})["blocked"])
		self.assertIsNone(tenant.state({}))

	def test_payment_extends_plan(self):
		sub = "t" + frappe.generate_hash(length=8).lower()
		t = frappe.get_doc({"doctype": "Mabni Tenant", "subdomain": sub, "company_name": "Test Co", "contact_name": "T", "email": f"{sub}@example.com",
			"country": "Pakistan", "mode": "Owner", "plan": "Owner", "status": "Trial", "trial_ends": add_days(nowdate(), 5)}).insert()
		self.assertEqual(t.currency, "PKR")
		self.assertEqual(t.site_host, f"{sub}.{common.base_domain()}")
		p = frappe.get_doc({"doctype": "Mabni Payment", "tenant": sub, "plan": "Builder", "billing_period": "Monthly", "periods": 2, "currency": "PKR",
			"amount": 27400, "status": "Verified"}).insert()
		t.reload()
		p.reload()
		self.assertEqual(getdate(p.period_from), getdate(add_days(nowdate(), 6)))  # after the trial
		self.assertEqual(t.status, "Active")
		self.assertEqual(t.plan, "Builder")
		self.assertEqual(t.mode, "Builder")
		first_end = getdate(t.paid_until)
		frappe.get_doc({"doctype": "Mabni Payment", "tenant": sub, "plan": "Builder", "billing_period": "Yearly", "periods": 1, "currency": "USD", "amount": 490, "status": "Verified"}).insert()
		t.reload()
		self.assertEqual(getdate(t.paid_until), getdate(add_days(frappe.utils.add_months(add_days(first_end, 1), 12), -1)))
		self.assertAlmostEqual(p.amount_usd, 27400 / frappe.get_single("Mabni Settings").usd_to_pkr, delta=0.01)
		with self.assertRaises(frappe.ValidationError):
			p.status = "Rejected"
			p.reject_reason = "x"
			p.save()

	def test_local_prices(self):
		pr = common.local_price(15, "Pakistan")
		self.assertEqual(pr["currency"], "PKR")
		self.assertEqual(pr["amount"] % (frappe.get_single("Mabni Settings").round_pkr or 1), 0)
		self.assertEqual(common.local_price(15, "Germany"), {"usd": 15.0, "currency": "USD", "amount": 15.0})

	def test_project_limit(self):
		have = frappe.db.count("Project", {"status": "Open"})
		frappe.local.conf["mabni"] = {"limits": {"projects": have}}
		with self.assertRaises(frappe.ValidationError):
			frappe.get_doc({"doctype": "Project", "project_name": "Over the limit " + frappe.generate_hash(length=4)}).insert()
		frappe.local.conf["mabni"] = {"limits": {"projects": have + 5}}
		frappe.get_doc({"doctype": "Project", "project_name": "Within the limit " + frappe.generate_hash(length=4)}).insert()

	def test_signup_checks(self):
		self.assertTrue(signup._name_problem("www"))
		self.assertTrue(signup._name_problem("ab"))
		self.assertTrue(signup._name_problem("pool-abc"))
		self.assertIsNone(signup._name_problem("al-noor-builders"))
		self.assertEqual(signup.suggest("Al Noor Builders (Pvt) Ltd")[:15], "al-noor-builder")
		with self.assertRaises(frappe.ValidationError):
			signup.start({"contact_name": "A", "email": "bad", "company_name": "X", "subdomain": "goodname", "password": "abc12345", "country": "Pakistan", "mode": "Owner", "agree": 1})
		with self.assertRaises(frappe.ValidationError):
			signup.start({"contact_name": "A", "email": "a@example.com", "company_name": "X", "subdomain": "goodname", "password": "short1", "country": "Pakistan", "mode": "Owner", "agree": 1})
		self.assertEqual(tenant._abbr("Al Noor Builders"), "ANB")
		self.assertEqual(tenant._abbr("خان ہاؤس"), "CO")

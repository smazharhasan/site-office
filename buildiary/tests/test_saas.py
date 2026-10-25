"""Buildiary Cloud: plan state, payments, limits and sign-up checks. Run: bench --site <site> run-tests --app buildiary --module buildiary.tests.test_saas"""

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import add_days, getdate, nowdate

from buildiary.saas import common, signup, tenant


class TestSaas(IntegrationTestCase):
	def setUp(self):
		frappe.set_user("Administrator")
		self._conf = {k: frappe.local.conf.get(k) for k in ("buildiary_control", "buildiary")}
		frappe.local.conf["buildiary_control"] = 1
		s = frappe.get_single("Buildiary Cloud Settings")
		self._base = s.base_domain
		if not s.base_domain:
			s.base_domain = "example.test"
			s.save()
		for p in (("Owner", 15, 150), ("Builder", 49, 490)):
			if not frappe.db.exists("Buildiary Plan", p[0]):
				frappe.get_doc({"doctype": "Buildiary Plan", "plan_name": p[0], "mode": p[0], "price_month_usd": p[1], "price_year_usd": p[2], "max_projects": 2, "max_users": 10}).insert()

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
		t = frappe.get_doc({"doctype": "Buildiary Tenant", "subdomain": sub, "company_name": "Test Co", "contact_name": "T", "email": f"{sub}@example.com",
			"country": "Pakistan", "mode": "Owner", "plan": "Owner", "status": "Trial", "trial_ends": add_days(nowdate(), 5)}).insert()
		self.assertEqual(t.currency, "PKR")
		self.assertEqual(t.site_host, f"{sub}.{common.base_domain()}")
		# confirming a bank transfer needs its receipt and the date the money arrived
		with self.assertRaises(frappe.ValidationError):
			frappe.get_doc({"doctype": "Buildiary Payment", "tenant": sub, "plan": "Builder", "billing_period": "Monthly", "periods": 2, "currency": "PKR",
				"amount": 27400, "status": "Verified", "method": "Bank transfer", "paid_on": nowdate()}).insert()
		p = frappe.get_doc({"doctype": "Buildiary Payment", "tenant": sub, "plan": "Builder", "billing_period": "Monthly", "periods": 2, "currency": "PKR",
			"amount": 27400, "status": "Verified", "method": "Bank transfer", "paid_on": nowdate(), "proof": "/private/files/receipt-test.png"}).insert()
		t.reload()
		p.reload()
		self.assertEqual(getdate(p.period_from), getdate(add_days(nowdate(), 6)))  # after the trial
		self.assertEqual(t.status, "Active")
		self.assertEqual(t.plan, "Builder")
		self.assertEqual(t.mode, "Builder")
		first_end = getdate(t.paid_until)
		frappe.get_doc({"doctype": "Buildiary Payment", "tenant": sub, "plan": "Builder", "billing_period": "Yearly", "periods": 1, "currency": "USD", "amount": 490,
			"status": "Verified", "method": "Cash", "paid_on": nowdate()}).insert()
		t.reload()
		self.assertEqual(getdate(t.paid_until), getdate(add_days(frappe.utils.add_months(add_days(first_end, 1), 12), -1)))
		self.assertAlmostEqual(p.amount_usd, 27400 / frappe.get_single("Buildiary Cloud Settings").usd_to_pkr, delta=0.01)
		with self.assertRaises(frappe.ValidationError):
			p.status = "Rejected"
			p.reject_reason = "x"
			p.save()

	def test_local_prices(self):
		pr = common.local_price(15, "Pakistan")
		self.assertEqual(pr["currency"], "PKR")
		self.assertEqual(pr["amount"] % (frappe.get_single("Buildiary Cloud Settings").round_pkr or 1), 0)
		self.assertEqual(common.local_price(15, "Germany"), {"usd": 15.0, "currency": "USD", "amount": 15.0})

	def test_currency_by_country(self):
		self.assertEqual(common.local_price(15, "Qatar")["currency"], "QAR")
		self.assertEqual(common.local_price(15, "Kuwait")["currency"], "USD")
		self.assertEqual(common.local_price(15, "Saudi Arabia", fixed=55)["amount"], 55)
		plan = frappe.get_doc("Buildiary Plan", "Owner")
		plan.price_month_sar = 59
		self.assertEqual(common.plan_price(plan.as_dict(), "Monthly", "Saudi Arabia"), {"usd": plan.price_month_usd, "currency": "SAR", "amount": 59})
		self.assertEqual(common.plan_price(plan.as_dict(), "Monthly", "Germany")["currency"], "USD")

	def test_bank_by_country(self):
		s = frappe.get_single("Buildiary Cloud Settings")
		keep = [r.as_dict() for r in s.bank_accounts]
		s.bank_accounts = []
		for region, bank in (("Pakistan", "PK Bank"), ("United Arab Emirates", "UAE Bank"), (common.BANK_OTHERS, "Saudi Bank")):
			s.append("bank_accounts", {"country": region, "currency": "USD", "bank_name": bank, "account_title": "SMH", "account_number": "1", "is_active": 1})
		s.save()
		frappe.clear_document_cache("Buildiary Cloud Settings")
		try:
			names = lambda c: [b.bank_name for b in common.bank_accounts(c)]
			self.assertEqual(names("Pakistan"), ["PK Bank"])
			self.assertEqual(names("United Arab Emirates"), ["UAE Bank"])
			self.assertEqual(names("Saudi Arabia"), ["Saudi Bank"])
			self.assertEqual(names("Qatar"), ["Saudi Bank"])
			self.assertEqual(names("Germany"), ["Saudi Bank"])
		finally:
			s.reload()
			s.bank_accounts = []
			for r in keep:
				r.pop("name", None)
				s.append("bank_accounts", r)
			s.save()

	def test_phone_by_country(self):
		self.assertEqual(common.phone_check("0301 2345678", "Pakistan"), ("+92 301 2345678", None))
		self.assertEqual(common.phone_check("+923012345678", "Pakistan")[0], "+92 301 2345678")
		self.assertEqual(common.phone_check("050 123 4567", "Saudi Arabia")[0], "+966 50 123 4567")
		self.assertEqual(common.phone_check("050 123 4567", "United Arab Emirates")[0], "+971 50 123 4567")
		self.assertEqual(common.phone_check("3312 3456", "Qatar")[0], "+974 3312 3456")
		self.assertEqual(common.phone_check("12345", "Pakistan"), (None, "invalid"))
		self.assertEqual(common.phone_check("021 3456 7890", "Pakistan"), (None, "not_mobile"))
		self.assertEqual(common.phone_check("", "Pakistan"), (None, "empty"))
		frappe.local.conf["buildiary_control"] = 1
		r = signup.check_phone("0301 2345678", "Pakistan")
		self.assertTrue(r["ok"])
		self.assertEqual(signup.check_phone("0301", "Pakistan")["problem"], "invalid")

	def test_project_limit(self):
		have = frappe.db.count("Project", {"status": "Open"})
		frappe.local.conf["buildiary"] = {"limits": {"projects": have}}
		with self.assertRaises(frappe.ValidationError):
			frappe.get_doc({"doctype": "Project", "project_name": "Over the limit " + frappe.generate_hash(length=4)}).insert()
		frappe.local.conf["buildiary"] = {"limits": {"projects": have + 5}}
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

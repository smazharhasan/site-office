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

	# ---------------------------------------------------------------- emails
	def _tenant(self, country="Saudi Arabia", lang="ar", **kw):
		sub = "m" + frappe.generate_hash(length=8).lower()
		d = {"doctype": "Buildiary Tenant", "subdomain": sub, "company_name": "Villa {{ x }} & Co", "contact_name": "Sara <b>", "email": f"{sub}@example.com",
			"country": country, "language": lang, "mode": "Owner", "plan": "Owner", "status": "Trial", "trial_ends": add_days(nowdate(), 14),
			"signed_up_on": nowdate()}
		d.update(kw)
		return frappe.get_doc(d).insert()

	def _capture(self):
		from unittest.mock import patch

		from buildiary.saas import mail

		sent = []
		return sent, patch.object(mail, "deliver", side_effect=lambda to, subject, html, **kw: sent.append((to, subject, html, kw)) or True)

	def test_bank_preference(self):
		s = frappe.get_single("Buildiary Cloud Settings")
		keep = [r.as_dict() for r in s.bank_accounts]
		s.bank_accounts = []
		for region, cur in (("Pakistan", "PKR"), ("United Arab Emirates", "AED"), (common.BANK_OTHERS, "SAR"), (common.BANK_OTHERS, "USD")):
			s.append("bank_accounts", {"country": region, "currency": cur, "bank_name": f"{cur} Bank", "account_title": "SMH", "iban": "X1", "is_active": 1})
		s.save()
		frappe.clear_document_cache("Buildiary Cloud Settings")
		try:
			curs = lambda c: [b.currency for b in common.bank_accounts(c)]
			self.assertEqual(curs("Saudi Arabia"), ["SAR"])
			self.assertEqual(curs("Pakistan"), ["PKR"])
			self.assertEqual(curs("United Arab Emirates"), ["AED"])
			self.assertEqual(curs("Qatar"), ["USD", "SAR"])  # no QAR account: USD first
			self.assertEqual(curs("Germany"), ["USD"])  # everyone else pays in USD
			self.assertEqual(common.price_in("Owner", "Monthly", "USD"), 15)
			self.assertEqual(common.price_in("Owner", "Monthly", "SAR"), common.plan_price("Owner", "Monthly", "Saudi Arabia")["amount"])
			self.assertEqual(common.entity("Germany", "ar"), "شركة إس إم إتش جلوبال سيرفيسز")
			self.assertEqual(common.entity("Pakistan"), "SMH Global Services (Private) Limited")
		finally:
			s.reload()
			s.bank_accounts = []
			for r in keep:
				r.pop("name", None)
				s.append("bank_accounts", r)
			s.save()

	def test_emails_in_each_language(self):
		from buildiary.saas import mail

		for lang, country in (("en", "Pakistan"), ("ur", "Pakistan"), ("ar", "Saudi Arabia"), ("en", "Germany")):
			t = self._tenant(country, lang)
			sent, p = self._capture()
			with p:
				mail.welcome(t)
				mail.tips(t)
				mail.ask_feedback(t)
				mail.trial_ending(t)
				mail.ended(t)
				mail.ended(t, paused=True)
				pay = frappe._dict(name="MP-1", plan="Owner", billing_period="Yearly", periods=2, currency="SAR", amount=1100, reference="TX1", paid_to="SAB",
					paid_on=nowdate(), period_from=nowdate(), period_to=add_days(nowdate(), 700), reject_reason="Not found")
				mail.payment_received(t, pay)
				mail.payment_confirmed(t, pay)
				mail.payment_rejected(t, pay)
			self.assertEqual(len(sent), 9)
			for to, subject, html, kw in sent:
				self.assertEqual(to, t.email)
				self.assertNotIn("{{", html)
				self.assertNotIn("<b>\"", html)
				self.assertNotIn("Sara <b>", html)  # escaped
				self.assertIn(mail.W[lang]["brand"] if lang != "en" else "Buildiary", html)
				self.assertIn('dir="rtl"' if lang in ("ur", "ar") else 'dir="ltr"', html)
			welcome = sent[0][2]
			self.assertIn(common.entity(country, lang), welcome)
			self.assertIn(f"{t.name}.", welcome)  # the workspace address
			self.assertIn("feedback?lang=" + lang, welcome)
			self.assertIn("Syed Mazhar Hasan", sent[0][3].get("sender_name") or "")

	def test_follow_up_schedule(self):
		from unittest.mock import patch

		from buildiary.saas import mail

		t = self._tenant("Pakistan", "en", signed_up_on=nowdate(), trial_ends=add_days(nowdate(), 14))
		calls = []
		names = ("tips", "ask_feedback", "trial_ending", "ended", "plan_ending")
		patches = [patch.object(mail, n, side_effect=(lambda n: lambda *a, **k: calls.append((n, k)) or True)(n)) for n in names]
		for p in patches:
			p.start()
		try:
			got = lambda day: mail.follow_up(t, today=add_days(nowdate(), day))
			self.assertIsNone(got(1))
			self.assertEqual(got(2), "tips")
			self.assertIsNone(got(3))  # sent once
			self.assertEqual(got(7), "feedback")
			self.assertTrue(got(11).startswith("trial-3"))
			self.assertIsNone(got(12))  # not every day
			self.assertTrue(got(14).startswith("trial-0"))
			t.status = "Payment due"
			self.assertTrue(got(15).startswith("due"))
			t.status = "Suspended"
			self.assertTrue(got(20).startswith("stop"))
			self.assertEqual([c[0] for c in calls], ["tips", "ask_feedback", "trial_ending", "trial_ending", "ended", "ended"])
			self.assertEqual(calls[3][1], {"today": True})
			self.assertEqual(calls[5][1], {"paused": True})
		finally:
			for p in patches:
				p.stop()

	def test_signup_survives_email_failure(self):
		from unittest.mock import patch

		from buildiary.saas import mail

		s = frappe.get_single("Buildiary Cloud Settings")
		keep = (s.require_email_verification, s.signups_open)
		frappe.db.set_single_value("Buildiary Cloud Settings", {"require_email_verification": 1, "signups_open": 1})
		frappe.clear_document_cache("Buildiary Cloud Settings")
		sub = "s" + frappe.generate_hash(length=8).lower()
		try:
			with patch.object(mail, "send_code", return_value=False), patch.object(frappe, "enqueue"):
				out = signup.start({"contact_name": "A", "phone": "+923001234567", "email": f"{sub}@example.com", "company_name": "X", "subdomain": sub,
					"password": "abc12345", "country": "Pakistan", "mode": "Owner", "agree": 1})
			self.assertFalse(out["verify"])
			self.assertEqual(frappe.db.get_value("Buildiary Tenant", sub, "status"), "Waiting")
			# an abandoned sign-up (code never entered, expired) frees its name
			frappe.db.set_value("Buildiary Tenant", sub, {"status": "Verifying email", "verify_expires": add_days(nowdate(), -1)})
			self.assertIsNone(signup._name_problem(sub))
		finally:
			frappe.db.set_single_value("Buildiary Cloud Settings", {"require_email_verification": keep[0], "signups_open": keep[1]})
			frappe.clear_document_cache("Buildiary Cloud Settings")

	def test_feedback(self):
		from unittest.mock import patch

		from buildiary.saas import feedback, mail

		t = self._tenant("Pakistan", "ur")
		with patch.object(mail, "deliver", return_value=True) as d:
			out = feedback.submit({"kind": "Feature request", "rating": 9, "message": "Please add tiles", "name": "Sara", "email": t.email.upper(), "language": "ur"})
		fb = frappe.get_doc("Buildiary Feedback", out["name"])
		self.assertEqual((fb.tenant, fb.rating, fb.language, fb.kind), (t.name, 5, "ur", "Feature request"))
		self.assertTrue(d.called)
		with self.assertRaises(frappe.ValidationError):
			feedback.submit({"message": "hi there", "email": "nope"})

	def test_mail_config(self):
		import json
		import os

		from buildiary.saas import mail

		path = os.path.join(frappe.local.sites_path, "common_site_config.json")
		before = open(path).read()
		s = frappe.get_single("Buildiary Cloud Settings")
		try:
			s.update({"mail_enabled": 1, "mail_from": "buildiary@example.com", "mail_server": "smtp-relay.gmail.com", "mail_port": 587, "mail_use_tls": 1, "mail_login": ""})
			mail.apply_config(s)
			conf = json.load(open(path))
			self.assertEqual((conf["mail_server"], conf["auto_email_id"], conf["disable_mail_smtp_authentication"]), ("smtp-relay.gmail.com", "buildiary@example.com", 1))
			self.assertNotIn("mail_login", conf)
			self.assertNotEqual(frappe.local.conf.get("mail_login"), "None")
			s.mail_enabled = 0
			mail.apply_config(s)
			self.assertNotIn("mail_server", json.load(open(path)))
		finally:
			open(path, "w").write(before)
			mail._reload_conf()

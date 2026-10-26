"""A phone as the computer's QR scanner (buildiary.scan, /scan) and Forgot password on the sign-in screen."""

from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from buildiary import field, scan


class TestScan(IntegrationTestCase):
	def setUp(self):
		frappe.local.request_ip = "127.0.0.1"

	def test_pairing(self):
		r = scan.pair(lang="ar")
		k = r["key"]
		self.assertTrue(r["url"].endswith(f"/scan?k={k}"))
		self.assertTrue(r["qr"].startswith("data:image/"))
		self.assertEqual(scan.take(k), {"alive": True, "text": None, "phone": None})
		self.assertEqual(scan.hello(k)["lang"], "ar")
		scan.push(k, "MMR1:one")
		scan.push(k, "MMR1:two")
		self.assertEqual(scan.take(k)["text"], "MMR1:one")
		self.assertEqual(scan.take(k)["text"], "MMR1:two")
		self.assertIsNone(scan.take(k)["text"])
		scan.push(k, "MMR1:stale")
		scan.take(k, clear=1)  # a new scan on the computer forgets what the phone sent before it
		self.assertIsNone(scan.take(k)["text"])
		self.assertEqual(scan.push(k, "  ")["ok"], False)
		for bad in ("nope", "../../x", "a" * 80, None):
			self.assertFalse(scan.take(bad)["alive"])
			self.assertFalse(scan.push(bad, "x")["alive"])
		scan.end(k)
		self.assertFalse(scan.take(k)["alive"])

	def test_page(self):
		from buildiary.www import scan as page

		k = scan.pair(lang="ur")["key"]
		frappe.form_dict.k = k
		ctx = frappe._dict()
		page.get_context(ctx)
		self.assertEqual(ctx.lang, "ur")
		self.assertIn(k, ctx.cfg)
		frappe.form_dict.k = "expired-key"
		ctx = frappe._dict()
		page.get_context(ctx)
		self.assertIn('"key":""', ctx.cfg)

	def test_forgot_password(self):
		email = "forgot-test@example.com"
		if not frappe.db.exists("User", email):
			frappe.get_doc({"doctype": "User", "email": email, "first_name": "Forgot", "send_welcome_email": 0, "language": "ar"}).insert(ignore_permissions=True)
		frappe.get_doc("User", email).add_roles("Stock User")  # a desk sign-in, like everyone on a workspace
		sent = []
		with patch("buildiary.saas.mail.deliver", side_effect=lambda to, subject, html, **kw: sent.append((to, subject, html)) or True):
			known = field.forgot_password(email, "en")
			unknown = field.forgot_password("nobody-here@example.com", "en")
			field.forgot_password("Administrator", "en")
		self.assertEqual(known, unknown)  # the same answer: the screen never tells who has a sign-in
		self.assertEqual(len(sent), 1)
		to, subject, html = sent[0]
		self.assertEqual(to, email)
		self.assertEqual(subject, "اختر كلمة مرور جديدة لبلدائري")  # in the person's own language
		self.assertIn("/update-password?key=", html)
		self.assertTrue(frappe.db.get_value("User", email, "reset_password_key"))

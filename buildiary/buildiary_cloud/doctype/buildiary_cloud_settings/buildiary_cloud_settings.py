from frappe.model.document import Document


class BuildiaryCloudSettings(Document):
	def validate(self):
		self.base_domain = (self.base_domain or "").strip().lower().strip(".").replace("https://", "").replace("http://", "")
		if self.base_domain and not self.control_host:
			self.control_host = f"my.{self.base_domain}"
		self.control_host = (self.control_host or "").strip().lower().replace("https://", "").replace("http://", "").strip("/")

	def on_update(self):
		# the AI key and the support details reach every workspace
		import frappe

		from buildiary.saas.common import is_control

		if not is_control():
			return
		frappe.enqueue("buildiary.saas.billing.push_all", queue="long", timeout=1800, job_id="buildiary-push-all", deduplicate=True)
		# outgoing email for the console and every workspace
		from buildiary.saas import mail

		mail.apply_config(self)


import frappe  # noqa: E402


@frappe.whitelist()
def send_test_email(to=None):
	"""Settings → Email → Send test email: sends one email now and says what happened."""
	from buildiary.saas import mail
	from buildiary.saas.common import is_control

	frappe.only_for("System Manager")
	if not is_control():
		frappe.throw("Only on the Buildiary console.")
	to = (to or frappe.db.get_value("User", frappe.session.user, "email") or "").strip()
	mail.apply_config()
	ok = mail.test(to)
	if ok:
		return {"ok": True, "to": to}
	err = frappe.get_all("Error Log", fields=["error"], order_by="creation desc", limit=1)
	q = frappe.get_all("Email Queue", fields=["error"], filters={"error": ["is", "set"]}, order_by="creation desc", limit=1)
	text = (q[0].error if q else "") or (err[0].error if err else "")
	return {"ok": False, "to": to, "error": text[-1500:]}


@frappe.whitelist()
def server_address():
	"""This server's public address, for Google's SMTP relay (allowed IP addresses)."""
	import requests

	frappe.only_for("System Manager")
	try:
		return requests.get("https://checkip.amazonaws.com", timeout=10).text.strip()
	except Exception:
		return ""

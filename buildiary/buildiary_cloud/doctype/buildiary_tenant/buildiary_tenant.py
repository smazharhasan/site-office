import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import add_days, getdate, nowdate

from buildiary.saas.common import NAME_RE, base_domain, country_info, host_for, push, tenant_state


class BuildiaryTenant(Document):
	def validate(self):
		self.subdomain = (self.subdomain or "").strip().lower()
		if self.is_new() and not NAME_RE.match(self.subdomain):
			frappe.throw(_("Workspace name: 3 to 30 lower-case letters, numbers or dashes, starting with a letter."))
		if not self.site_host and base_domain():
			self.site_host = host_for(self.subdomain)
		if self.country:
			ci = country_info(self.country)
			self.currency, self.time_zone = ci["currency"], ci["time_zone"]
		if self.status in ("Trial", "Active", "Payment due", "Suspended"):
			new = tenant_state(self)
			if new == "Suspended" and self.status != "Suspended":
				self.suspended_on = nowdate()
			self.status = new

	def on_update(self):
		push(self)

	@frappe.whitelist()
	def extend_trial(self, days=7):
		start = max(getdate(self.trial_ends), getdate(nowdate())) if self.trial_ends else getdate(nowdate())
		self.trial_ends = add_days(start, int(days))
		if not self.paid_until and self.status in ("Payment due", "Suspended"):
			self.status = "Trial"
		self.save()
		return self.trial_ends

	@frappe.whitelist()
	def retry_setup(self):
		if self.status != "Failed":
			frappe.throw(_("Only a failed set-up can be tried again."))
		self.db_set("status", "Waiting")
		frappe.enqueue("buildiary.saas.provision.provision", queue="long", timeout=3600, tenant=self.name, job_id=f"buildiary-provision-{self.name}", deduplicate=True)
		return "queued"

	@frappe.whitelist()
	def check_now(self):
		from buildiary.saas.billing import check_tenant

		check_tenant(self, reminders=False)
		return self.status

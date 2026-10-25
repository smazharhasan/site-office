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

		frappe.enqueue("buildiary.saas.billing.push_all", queue="long", timeout=1800, job_id="buildiary-push-all", deduplicate=True)

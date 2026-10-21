import frappe
from frappe import _
from frappe.model.document import Document


class SiteAttendance(Document):
	def validate(self):
		if not self.project:
			self.project = frappe.db.get_single_value("Mimaar Settings", "default_project")
		same = frappe.db.get_value("Site Attendance", {"date": self.date, "project": self.project, "docstatus": ["<", 2], "name": ["!=", self.name]})
		if same:
			frappe.throw(_("Attendance for {0} is already marked in {1}. Open that one and add the workers there.").format(frappe.format(self.date, "Date"), same))
		seen = set()
		for r in self.rows:
			if r.worker in seen:
				frappe.throw(_("Row {0}: {1} is entered twice.").format(r.idx, r.worker_name or r.worker))
			seen.add(r.worker)
			status = frappe.db.get_value("Site Worker", r.worker, "status")
			if status != "Active" and r.status != "Absent":
				frappe.throw(_("Row {0}: {1} is marked {2} in the worker register and can't be marked present.").format(r.idx, r.worker_name or r.worker, _(status)))
		self.present = sum(1 for r in self.rows if r.status == "Present")
		self.half_day = sum(1 for r in self.rows if r.status == "Half day")

	def before_submit(self):
		if not self.rows:
			frappe.throw(_("Add the workers first."))
		if frappe.db.get_single_value("Mimaar Settings", "require_attendance_photo"):
			if not self.group_photo:
				frappe.throw(_("Take the team photo before submitting the attendance."), title=_("Team photo needed"))
			if not self.location:
				frappe.throw(_("The phone's location is needed. Allow location for this site in the browser or app, then press Update location."), title=_("Location needed"))

frappe.query_reports["Labour Attendance Summary"] = {
	filters: [
		{ fieldname: "from_date", label: __("From"), fieldtype: "Date", reqd: 1, default: frappe.datetime.month_start() },
		{ fieldname: "to_date", label: __("To"), fieldtype: "Date", reqd: 1, default: frappe.datetime.get_today() },
		{ fieldname: "project", label: __("Project"), fieldtype: "Link", options: "Project" },
		{ fieldname: "contractor", label: __("Contractor / supplier"), fieldtype: "Link", options: "Supplier" },
		{ fieldname: "worker", label: __("Worker"), fieldtype: "Link", options: "Site Worker" },
	],
};

frappe.listview_settings["Buildiary Tenant"] = {
	get_indicator(doc) {
		const c = { Trial: "blue", Active: "green", "Payment due": "orange", Suspended: "red", Failed: "red", Cancelled: "gray", "Setting up": "yellow", Waiting: "yellow", "Verifying email": "yellow" }[doc.status] || "gray";
		return [__(doc.status), c, "status,=," + doc.status];
	},
};

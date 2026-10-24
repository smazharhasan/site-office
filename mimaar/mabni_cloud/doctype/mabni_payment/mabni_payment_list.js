frappe.listview_settings["Mabni Payment"] = {
	get_indicator(doc) {
		const c = { "Waiting for check": "orange", Verified: "green", Rejected: "red" }[doc.status] || "gray";
		return [__(doc.status), c, "status,=," + doc.status];
	},
};

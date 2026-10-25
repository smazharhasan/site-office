frappe.listview_settings["Supplier Quotation"] = Object.assign(frappe.listview_settings["Supplier Quotation"] || {}, {
	add_fields: ["buildiary_final", "buildiary_revision", "docstatus", "status"],
	get_indicator(doc) {
		if (doc.docstatus === 1 && doc.buildiary_final) return [__("Final"), "green", "buildiary_final,=,1"];
		if (doc.docstatus === 2) return [__("Replaced / cancelled"), "gray", "docstatus,=,2"];
		if (doc.docstatus === 1) return [__("Confirmed"), "blue", "docstatus,=,1"];
		return [__("Draft"), "red", "docstatus,=,0"];
	},
	onload(list) {
		list.page.add_inner_button(__("Scan a quotation"), () => { buildiary._scan_next = true; frappe.new_doc("Supplier Quotation"); });
	},
});

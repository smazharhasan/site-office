frappe.listview_settings["Supplier"] = Object.assign(frappe.listview_settings["Supplier"] || {}, {
	onload(list) {
		list.page.add_inner_button(__("New supplier from their quotation"), () => { buildiary._scan_next = true; frappe.new_doc("Supplier Quotation"); });
	},
});

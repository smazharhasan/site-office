frappe.ui.form.on("Stock Entry", {
	refresh(frm) {
		if (frm.doc.docstatus === 0 && frm.doc.stock_entry_type === "Material Issue")
			frm.dashboard.set_headline(__("Release to work: only what is in the store can be released. Enter who receives it."), "blue");
	},
});

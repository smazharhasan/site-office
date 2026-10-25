// Request for quotation: suppliers of the same items are suggested; once submitted
// (finalised and locked) it is sent to each supplier by e-mail, WhatsApp or PDF.
frappe.ui.form.on("Request for Quotation", {
	refresh(frm) {
		const d = frm.doc;
		if (d.docstatus === 0) {
			frm.add_custom_button(__("Add suppliers of these items"), () => {
				const items = (d.items || []).map((i) => i.item_code).filter(Boolean);
				if (!items.length) return frappe.msgprint(__("Add the items first."));
				frappe.call({ method: "buildiary.api.suppliers_for_items", args: { items } }).then((r) => {
					const have = new Set((d.suppliers || []).map((s) => s.supplier)); let n = 0;
					(r.message || []).forEach((s) => { if (!have.has(s)) { frm.add_child("suppliers", { supplier: s }); n++; } });
					frm.refresh_field("suppliers");
					frappe.show_alert({ message: n ? __("{0} suppliers added", [n]) : __("No other supplier of these items yet"), indicator: n ? "green" : "orange" });
				});
			});
			frm.dashboard.set_headline(__("Add the items and suppliers, then submit to finalise and lock it. After that it is sent to each supplier."), "blue");
		}
		if (d.docstatus === 1) {
			frm.add_custom_button(__("PDF"), () => buildiary.pdf(frm), __("Send"));
			(d.suppliers || []).forEach((s) => {
				frm.add_custom_button(__("WhatsApp: {0}", [s.supplier_name || s.supplier]), () => buildiary.share(frm, s.supplier), __("Send"));
			});
		}
	},
});

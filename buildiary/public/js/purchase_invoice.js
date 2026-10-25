// Supplier invoice: scanned (printed or handwritten, English or Urdu) against the goods received.
frappe.ui.form.on("Purchase Invoice", {
	refresh(frm) {
		const d = frm.doc;
		if (d.docstatus === 0 && !d.is_return) {
			frm.add_custom_button(__("Scan the bill"), () => buildiary.scan_invoice(frm)).addClass("btn-primary");
		}
		if (d.docstatus === 1 && flt(d.outstanding_amount) > 0) {
			frm.dashboard.set_headline(__("Due to the supplier: {0}. Pay it with Create → Payment; advances already paid can be set against it.", [buildiary.money(d.outstanding_amount)]), "orange");
		}
	},
});

buildiary.scan_invoice = async function (frm) {
	await buildiary.save_first(frm);
	const url = await buildiary.pick_file({ doctype: frm.doctype, docname: frm.doc.name });
	await frm.set_value("buildiary_bill_scan", url);
	if (!buildiary.ai_on()) { await frm.save(); return frappe.show_alert({ message: __("Scan attached. Enter the bill number and quantities."), indicator: "blue" }); }
	frappe.dom.freeze(__("Reading the document…"));
	let r;
	try { r = await frappe.call({ method: "buildiary.ai.read_invoice", args: { file_url: url, doctype: frm.doctype, name: frm.doc.name } }); } finally { frappe.dom.unfreeze(); }
	const x = r.message || {};
	if (x.invoiceNo) await frm.set_value("bill_no", x.invoiceNo);
	if (x.date) await frm.set_value("bill_date", x.date);
	if (x.dueDate) await frm.set_value("due_date", x.dueDate);
	const got = {};
	(x.lines || []).forEach((l) => { if (l.index != null) got[l.index] = (got[l.index] || 0) + (l.qty || 0); });
	if (Object.keys(got).length) {
		const rows = frm.doc.items.slice();
		for (let i = rows.length - 1; i >= 0; i--) {
			const row = rows[i];
			if (!got[i]) { frm.get_field("items").grid.grid_rows[i] && frm.get_field("items").grid.grid_rows[i].remove(); continue; }
			if (got[i] > flt(row.qty)) frappe.show_alert({ message: __("{0}: billed {1}, but only {2} received and not yet billed.", [row.item_name, got[i], row.qty]), indicator: "red" }, 8);
			await frappe.model.set_value(row.doctype, row.name, "qty", Math.min(got[i], flt(row.qty)));
		}
		frm.refresh_field("items");
	}
	await frm.save();
	if (x.grandTotal && Math.abs(flt(frm.doc.grand_total) - x.grandTotal) > 1)
		frappe.msgprint(__("The total written on the bill is {0}; at the purchase order rates the received quantities come to {1}. Check before submitting.", [buildiary.money(x.grandTotal), buildiary.money(frm.doc.grand_total)]));
	else frappe.show_alert({ message: __("Filled in from the bill. Check every line and number."), indicator: "green" }, 7);
};

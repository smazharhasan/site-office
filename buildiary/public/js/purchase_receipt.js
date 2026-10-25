// Receiving at site: only with the supplier's delivery note (scanned) and the receiver's photo.
frappe.ui.form.on("Purchase Receipt", {
	onload(frm) {
		if (frm.is_new() && !frm.doc.mimaar_received_by) frm.set_value("mimaar_received_by", frappe.session.user_fullname);
	},
	refresh(frm) {
		const d = frm.doc;
		if (d.docstatus === 0 && !d.is_return) {
			frm.add_custom_button(__("Scan the delivery note / bill"), () => mimaar.scan_delivery(frm)).addClass("btn-primary");
			const need = [];
			if (!d.supplier_delivery_note) need.push(__("delivery note number"));
			if (!d.mimaar_dn_scan) need.push(__("delivery note scan"));
			if (!d.mimaar_receiver_photo) need.push(__("receiver's photo"));
			if (need.length) frm.dashboard.set_headline(__("Before submitting: {0}. Count what actually arrived; partial deliveries keep the purchase order open.", [need.join(", ")]), "orange");
		}
	},
});

mimaar.scan_delivery = async function (frm) {
	await mimaar.save_first(frm);
	const url = await mimaar.pick_file({ doctype: frm.doctype, docname: frm.doc.name });
	await frm.set_value("mimaar_dn_scan", url);
	if (!mimaar.ai_on()) { await frm.save(); return frappe.show_alert({ message: __("Scan attached. Enter the delivery note number and quantities."), indicator: "blue" }); }
	frappe.dom.freeze(__("Reading the document…"));
	let r;
	try { r = await frappe.call({ method: "mimaar.ai.read_delivery", args: { file_url: url, doctype: frm.doctype, name: frm.doc.name } }); } finally { frappe.dom.unfreeze(); }
	const x = r.message || {};
	if (x.docNo) await frm.set_value("supplier_delivery_note", x.docNo);
	if (x.vehicle) await frm.set_value("mimaar_vehicle", x.vehicle);
	const got = {};
	(x.lines || []).forEach((l) => { if (l.index != null) got[l.index] = (got[l.index] || 0) + (l.qty || 0); });
	if (Object.keys(got).length) {
		const rows = frm.doc.items.slice();
		for (let i = rows.length - 1; i >= 0; i--) {
			const row = rows[i];
			if (!got[i]) { frm.get_field("items").grid.grid_rows[i] && frm.get_field("items").grid.grid_rows[i].remove(); continue; }
			const q = Math.min(got[i], flt(row.qty));
			if (got[i] > flt(row.qty)) frappe.show_alert({ message: __("{0}: the document shows {1}, more than is still to come ({2}).", [row.item_name, got[i], row.qty]), indicator: "red" }, 8);
			await frappe.model.set_value(row.doctype, row.name, "received_qty", q);
			await frappe.model.set_value(row.doctype, row.name, "qty", q);
		}
		frm.refresh_field("items");
	}
	if (x.poNo) {
		const pos = [...new Set(frm.doc.items.map((i) => i.purchase_order).filter(Boolean))];
		if (pos.length && !pos.some((p) => String(x.poNo).replace(/\s/g, "").toUpperCase().includes(p.replace(/\s/g, "").toUpperCase())))
			frappe.msgprint(__("The document mentions {0}, not {1}. Check it is the right purchase order.", [x.poNo, pos.join(", ")]));
	}
	await frm.save();
	frappe.show_alert({ message: __("Quantities filled in from the document. Count what actually arrived and correct them."), indicator: "green" }, 7);
};

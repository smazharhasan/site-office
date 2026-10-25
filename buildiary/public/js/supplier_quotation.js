// Supplier quotation: scan the supplier's document (registers a new supplier too),
// confirm by submitting, revise with Cancel → Amend, lock the agreed one as final.
frappe.ui.form.on("Supplier Quotation", {
	onload(frm) {
		if (frm.is_new() && mimaar._scan_next) {
			mimaar._scan_next = false;
			setTimeout(() => mimaar.scan_quotation(frm), 400);
		}
	},
	refresh(frm) {
		const d = frm.doc;
		if (d.docstatus === 0) {
			frm.add_custom_button(__("Scan the supplier's document"), () => mimaar.scan_quotation(frm)).addClass("btn-primary");
			if (d.amended_from) frm.dashboard.set_headline(__("Revision {0} of {1}. Write what changed, then submit to confirm.", [(d.mimaar_revision || 1), d.amended_from]), "blue");
		}
		if (d.docstatus === 1 && !d.mimaar_final) {
			frm.dashboard.set_headline(__("Confirmed. It can't be edited: a change in price, discount or items is a new revision (Cancel, then Amend). Lock it as final when agreed."), "blue");
			frm.add_custom_button(__("Lock as final"), () => {
				frappe.confirm(__("Lock {0} as the final quotation? No more revisions can be made after this.", [d.name]), () =>
					frappe.call({ method: "mimaar.procurement.mark_final", args: { name: d.name }, freeze: true }).then(() => frm.reload_doc()));
			}).addClass("btn-primary");
			setTimeout(() => frm.remove_custom_button(__("Purchase Order"), __("Create")), 50);
		}
		if (d.docstatus === 1 && d.mimaar_final) {
			frm.dashboard.set_headline(__("Final quotation, locked on {0}. Raise the purchase order from it (Create → Purchase Order), or ask the supplier for their contract.", [frappe.datetime.str_to_user(d.mimaar_final_on)]), "green");
			frm.page.btn_secondary && frm.page.btn_secondary.addClass("hide");
			if (!d.mimaar_contract_requested)
				frm.add_custom_button(__("Ask for a contract instead"), () =>
					frappe.call({ method: "mimaar.procurement.request_contract", args: { name: d.name } }).then(() => frm.reload_doc()), __("Create"));
		}
		if (d.docstatus === 2) {
			frappe.db.get_value("Supplier Quotation", { amended_from: d.name }, "name").then((r) => {
				const n = r.message && r.message.name;
				if (n) frm.dashboard.set_headline(__("Replaced by revision {0}.", [`<a href="/desk/supplier-quotation/${encodeURIComponent(n)}">${n}</a>`]), "orange");
			});
		}
	},
});

mimaar.scan_quotation = async function (frm) {
	if (!mimaar.ai_on()) {
		const url = await mimaar.pick_file({});
		frm.set_value("mimaar_document", url);
		frappe.show_alert({ message: __("Document attached. AI reading is off: type in the lines."), indicator: "blue" });
		return;
	}
	const url = await mimaar.pick_file({});
	frappe.dom.freeze(__("Reading the document…"));
	let r;
	try { r = await frappe.call({ method: "mimaar.ai.read_quotation", args: { file_url: url } }); } finally { frappe.dom.unfreeze(); }
	const q = r.message; if (!q) return;
	frm.set_value("mimaar_document", url);
	let supplier = q.supplier;
	if (!supplier && q.supplier_details && q.supplier_details.name) supplier = await mimaar.new_supplier_dialog(q);
	if (supplier) await frm.set_value("supplier", supplier);
	await mimaar.review_lines(frm, q);
};

mimaar.new_supplier_dialog = function (q) {
	const s = q.supplier_details || {};
	return new Promise((resolve) => {
		const d = new frappe.ui.Dialog({
			title: __("New supplier from this quotation"),
			fields: [
				{ fieldname: "name", fieldtype: "Data", label: __("Company / business name"), reqd: 1, default: s.name },
				{ fieldname: "work_area", fieldtype: "Select", label: __("Work area"), options: "Materials\nGrey structure\nFinishing\nDesign\nTesting & verification\nServices", default: "Materials" },
				{ fieldname: "phone", fieldtype: "Data", label: __("Mobile (for WhatsApp)"), reqd: 1, default: s.phone, options: "Phone" },
				{ fieldname: "contact", fieldtype: "Data", label: __("Contact person"), default: s.contact },
				{ fieldname: "cb", fieldtype: "Column Break" },
				{ fieldname: "email", fieldtype: "Data", label: __("Email"), default: s.email, options: "Email" },
				{ fieldname: "ntn", fieldtype: "Data", label: __("NTN"), default: s.ntn },
				{ fieldname: "address", fieldtype: "Small Text", label: __("Address"), default: s.address },
			],
			primary_action_label: __("Register supplier"),
			primary_action(v) {
				frappe.call({ method: "mimaar.api.register_supplier", args: Object.assign({ payment_terms: q.payment_terms, delivery_time: q.delivery_time }, v), freeze: true })
					.then((r) => { d.hide(); resolve(r.message); });
			},
			secondary_action_label: __("Choose an existing supplier"),
			secondary_action() { d.hide(); resolve(null); },
		});
		d.show();
		mimaar._review_dialog = d;
	});
};

mimaar.review_lines = function (frm, q) {
	return new Promise((resolve) => {
		const lines = (q.lines || []).map((l) => ({ text: l.text, item_code: l.item_code, new_item: 0, uom: l.uom || "Nos", qty: l.qty, rate: l.rate, discount_percentage: l.discount_percentage || 0 }));
		const d = new frappe.ui.Dialog({
			title: __("Check the lines read from the document"), size: "extra-large",
			fields: [
				{ fieldtype: "HTML", options: `<p class="text-muted">${__("Choose the catalogue item for each line, or tick “New item” to add it to the catalogue. Check every quantity and rate.")}</p>` },
				{ fieldname: "lines", fieldtype: "Table", label: __("Lines"), cannot_add_rows: false, in_place_edit: true, data: lines,
					fields: [
						{ fieldname: "text", fieldtype: "Data", label: __("On the document"), in_list_view: 1, columns: 3, read_only: 1 },
						{ fieldname: "item_code", fieldtype: "Link", options: "Item", label: __("Item"), in_list_view: 1, columns: 2 },
						{ fieldname: "new_item", fieldtype: "Check", label: __("New item"), in_list_view: 1, columns: 1 },
						{ fieldname: "uom", fieldtype: "Link", options: "UOM", label: __("Unit"), in_list_view: 1, columns: 1 },
						{ fieldname: "qty", fieldtype: "Float", label: __("Qty"), in_list_view: 1, columns: 1 },
						{ fieldname: "rate", fieldtype: "Currency", label: __("Rate"), in_list_view: 1, columns: 1 },
						{ fieldname: "discount_percentage", fieldtype: "Percent", label: __("Disc %"), in_list_view: 1, columns: 1 },
					] },
				{ fieldname: "sb", fieldtype: "Section Break" },
				{ fieldname: "quotation_number", fieldtype: "Data", label: __("Their quotation no."), default: q.quotation_number },
				{ fieldname: "transaction_date", fieldtype: "Date", label: __("Date"), default: q.transaction_date },
				{ fieldname: "valid_till", fieldtype: "Date", label: __("Valid until"), default: q.valid_till },
				{ fieldname: "discount_amount", fieldtype: "Currency", label: __("Overall discount (Rs)"), default: q.discount_amount },
				{ fieldname: "cb", fieldtype: "Column Break" },
				{ fieldname: "mimaar_payment_terms", fieldtype: "Small Text", label: __("Payment terms"), default: q.payment_terms, reqd: 1 },
				{ fieldname: "mimaar_advance_percent", fieldtype: "Percent", label: __("Advance asked (%)"), default: q.advance_percent },
				{ fieldname: "mimaar_delivery_time", fieldtype: "Data", label: __("Delivery / completion time"), default: q.delivery_time, reqd: 1 },
				{ fieldname: "terms", fieldtype: "Small Text", label: __("Other terms"), default: q.terms },
				{ fieldname: "sb2", fieldtype: "Section Break" },
				{ fieldtype: "HTML", options: `<div class="text-muted">${__("On the document")}: ${__("tax")} ${q.tax_percent || 0}% · ${__("other charges")} ${mimaar.money(q.other_charges)} · ${__("grand total")} <b>${mimaar.money(q.grand_total)}</b></div>` },
			],
			primary_action_label: __("Fill in the quotation"),
			async primary_action(v) {
				const all = v.lines || [];
				const open = all.findIndex((x) => !x.item_code && !x.new_item);
				if (open >= 0) return frappe.msgprint(__("Line {0} ({1}): choose the catalogue item, or tick “New item” to add it. Delete the line if it shouldn't be in the quotation.", [open + 1, all[open].text || ""]));
				const rows = all;
				if (!rows.length) return frappe.msgprint(__("Choose an item for at least one line."));
				if (rows.some((x) => !(x.qty > 0) || !(x.rate > 0))) return frappe.msgprint(__("Every line needs a quantity and a rate above 0."));
				d.hide(); frappe.dom.freeze(__("Filling in…"));
				try {
					for (const x of rows) if (!x.item_code) x.item_code = (await frappe.call({ method: "mimaar.api.new_item", args: { item_name: x.text, uom: x.uom || "Nos" } })).message;
					frm.clear_table("items");
					for (const x of rows) {
						const row = frm.add_child("items");
						await frappe.model.set_value(row.doctype, row.name, "item_code", x.item_code);
						await frappe.model.set_value(row.doctype, row.name, "qty", x.qty);
						if (x.uom) await frappe.model.set_value(row.doctype, row.name, "uom", x.uom);
						await frappe.model.set_value(row.doctype, row.name, "rate", x.rate);
						if (x.discount_percentage) await frappe.model.set_value(row.doctype, row.name, "discount_percentage", x.discount_percentage);
					}
					frm.refresh_field("items");
					for (const k of ["quotation_number", "transaction_date", "valid_till", "mimaar_payment_terms", "mimaar_advance_percent", "mimaar_delivery_time", "terms"]) if (v[k] != null && v[k] !== "") await frm.set_value(k, v[k]);
					if (v.discount_amount) { await frm.set_value("apply_discount_on", "Net Total"); await frm.set_value("discount_amount", v.discount_amount); }
				} finally { frappe.dom.unfreeze(); }
				if (q.tax_percent || q.other_charges) frappe.msgprint(__("The document shows tax {0}% and other charges {1}. Add them in the Taxes and Charges table.", [q.tax_percent || 0, mimaar.money(q.other_charges)]));
				else if (q.grand_total && Math.abs((frm.doc.grand_total || 0) - q.grand_total) > 1) frappe.msgprint(__("Check the numbers: the document total is {0}, the lines add up to {1}.", [mimaar.money(q.grand_total), mimaar.money(frm.doc.grand_total)]));
				resolve();
			},
		});
		d.show();
		mimaar._review_dialog = d;
	});
};

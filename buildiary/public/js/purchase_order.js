// Purchase order: raised from the final quotation; edit freely while draft (every save
// is kept in the history); once submitted it is locked and can be sent.
frappe.ui.form.on("Purchase Order", {
	refresh(frm) {
		const d = frm.doc;
		if (d.docstatus === 0) {
			frm.dashboard.set_headline(__("Draft: change it as needed, every saved version is kept in the activity below. Submit to lock it; only a locked purchase order can be sent."), "blue");
		}
		if (d.docstatus === 1) {
			buildiary.send_buttons(frm);
			// a submitted order is locked: no changing items, quantities or rates afterwards
			if (frappe.boot.buildiary && frappe.boot.buildiary.lock_po) setTimeout(() => frm.remove_custom_button(__("Update Items")), 0);
			frm.page.btn_secondary && frm.page.btn_secondary.addClass("hide");
			const pct = flt(d.buildiary_advance_percent);
			if (pct > 0 && !["Closed", "Completed"].includes(d.status)) {
				const limit = flt(d.grand_total) * pct / 100, left = limit - flt(d.advance_paid);
				if (left > 1) frm.add_custom_button(__("Advance payment ({0})", [buildiary.money(left)]), () => buildiary.advance(frm, left), __("Create"));
			}
			const rec = flt(d.per_received);
			if (rec > 0 && rec < 100) frm.dashboard.set_headline(__("{0}% received. The order stays open until everything has arrived.", [Math.round(rec)]), "orange");
		}
	},
});

buildiary.advance = function (frm, amount) {
	frappe.call({
		method: "erpnext.accounts.doctype.payment_entry.payment_entry.get_payment_entry",
		args: { dt: "Purchase Order", dn: frm.doc.name, party_amount: amount },
		freeze: true,
	}).then((r) => {
		const doc = frappe.model.sync(r.message)[0];
		frappe.set_route("Form", doc.doctype, doc.name);
	});
};

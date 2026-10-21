// Paying a supplier: only against due invoices or a purchase order advance, with proof.
frappe.ui.form.on("Payment Entry", {
	refresh(frm) { mimaar.pe_due(frm); },
	party(frm) { mimaar.pe_due(frm); },
});
mimaar.pe_due = function (frm) {
	const d = frm.doc;
	if (d.docstatus !== 0 || d.payment_type !== "Pay" || d.party_type !== "Supplier" || !d.party) return;
	frappe.call({ method: "mimaar.api.supplier_statement", args: { supplier: d.party } }).then((r) => {
		const s = r.message || {};
		frm.dashboard.set_headline(s.balance >= 0
			? __("Due to {0}: {1}. Pay only against their due invoices (Get Outstanding Invoices), or as an advance from the purchase order.", [s.supplier_name, mimaar.money(s.due)])
			: __("{0} already holds an advance of {1}.", [s.supplier_name, mimaar.money(s.advance)]), s.balance > 0 ? "orange" : "blue");
	});
};

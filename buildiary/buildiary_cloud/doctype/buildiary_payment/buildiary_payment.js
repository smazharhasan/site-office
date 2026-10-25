// A payment from a customer. When money has arrived in our bank: attach the receipt and confirm;
// the customer's licence is then extended and they get an email.
frappe.ui.form.on("Buildiary Payment", {
	setup(frm) {
		frm.set_query("plan", () => ({ filters: { is_active: 1 } }));
	},
	onload(frm) {
		if (frm.is_new() && frm.doc.tenant && !frm.doc.amount) fill(frm);
		if (frm.is_new() && !frm.doc.paid_on) frm.set_value("paid_on", frappe.datetime.get_today());
	},
	refresh(frm) {
		if (frm.is_new()) {
			frm.set_intro(__("Attach the bank's receipt, check the amount and save: the customer's licence is activated straight away."), "blue");
			return;
		}
		if (frm.doc.status !== "Waiting for check") return;
		frm.set_intro(__("The customer reported this transfer. When the money is in our account, attach the receipt (if missing) and confirm."), "orange");
		frm.add_custom_button(__("Payment received: activate licence"), () => {
			if (frm.doc.method === "Bank transfer" && !frm.doc.proof) {
				frappe.msgprint(__("Attach the receipt of the bank transfer first (field: Receipt)."));
				frm.scroll_to_field("proof");
				return;
			}
			frappe.confirm(__("Mark this payment as received and activate {0}'s licence?", [frm.doc.company_name || frm.doc.tenant]), () => {
				frm.set_value("status", "Verified");
				frm.save();
			});
		}).addClass("btn-primary");
		frm.add_custom_button(__("Reject"), () => {
			frappe.prompt({ fieldname: "why", fieldtype: "Small Text", label: __("Why? (the customer sees this)"), reqd: 1 }, (v) => {
				frm.set_value("reject_reason", v.why);
				frm.set_value("status", "Rejected");
				frm.save();
			}, __("Reject payment"));
		});
	},
	tenant(frm) { if (frm.is_new()) fill(frm); },
	plan(frm) { if (frm.is_new()) fill(frm, true); },
	billing_period(frm) { if (frm.is_new()) fill(frm, true); },
	periods(frm) { if (frm.is_new()) fill(frm, true); },
});

// what the customer owes for the chosen plan and period, in their money, and the account they pay into
function fill(frm, amount_only) {
	if (!frm.doc.tenant) return;
	frappe.call("buildiary.saas.api.payment_defaults", {
		tenant: frm.doc.tenant, plan: frm.doc.plan, billing_period: frm.doc.billing_period, periods: frm.doc.periods || 1,
	}).then((r) => {
		const d = r.message || {};
		if (!amount_only) {
			if (!frm.doc.plan && d.plan) frm.set_value("plan", d.plan);
			if (d.billing_period && !frm.doc.billing_period) frm.set_value("billing_period", d.billing_period);
			if (d.paid_to && !frm.doc.paid_to) frm.set_value("paid_to", d.paid_to);
		}
		if (d.currency) frm.set_value("currency", d.currency);
		if (d.amount) frm.set_value("amount", d.amount);
	});
}

frappe.ui.form.on("Buildiary Payment", {
	refresh(frm) {
		if (frm.is_new() || frm.doc.status !== "Waiting for check") return;
		frm.add_custom_button(__("Payment received: activate"), () => {
			frappe.confirm(__("Mark this payment as received and extend the customer's plan?"), () => {
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
});

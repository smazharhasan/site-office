frappe.ui.form.on("Mabni Tenant", {
	refresh(frm) {
		if (frm.is_new()) return;
		if (frm.doc.site_host && ["Trial", "Active", "Payment due", "Suspended"].includes(frm.doc.status)) {
			frm.add_custom_button(__("Open workspace"), () => window.open(`https://${frm.doc.site_host}/login`, "_blank"));
		}
		frm.add_custom_button(__("Extend trial by 7 days"), () =>
			frm.call("extend_trial", { days: 7 }).then(() => frm.reload_doc()), __("Plan"));
		frm.add_custom_button(__("Record a payment"), () =>
			frappe.new_doc("Mabni Payment", { tenant: frm.doc.name, plan: frm.doc.plan, billing_period: frm.doc.billing_period, status: "Verified", method: "Bank transfer" }), __("Plan"));
		frm.add_custom_button(__("Check usage and status now"), () =>
			frm.call("check_now").then(() => frm.reload_doc()), __("Plan"));
		if (frm.doc.status === "Failed") {
			frm.add_custom_button(__("Retry set-up"), () => frm.call("retry_setup").then(() => frm.reload_doc())).addClass("btn-primary");
		}
		const c = { Trial: "blue", Active: "green", "Payment due": "orange", Suspended: "red", Failed: "red", "Setting up": "yellow", Waiting: "yellow" }[frm.doc.status] || "gray";
		frm.page.set_indicator(__(frm.doc.status), c);
	},
});

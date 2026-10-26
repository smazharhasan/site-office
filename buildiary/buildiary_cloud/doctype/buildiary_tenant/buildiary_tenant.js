frappe.ui.form.on("Buildiary Tenant", {
	refresh(frm) {
		if (frm.is_new()) return;
		if (frm.doc.site_host && ["Trial", "Active", "Payment due", "Suspended"].includes(frm.doc.status)) {
			frm.add_custom_button(__("Open workspace"), () => window.open(`https://${frm.doc.site_host}/login`, "_blank"));
		}
		frm.add_custom_button(__("Extend trial by 7 days"), () =>
			frm.call("extend_trial", { days: 7 }).then(() => frm.reload_doc()), __("Plan"));
		if (!frm.doc.is_internal) {
			// money arrived in our bank: record it with the receipt; saving activates the full licence
			frm.add_custom_button(__("Payment received"), () =>
				frappe.new_doc("Buildiary Payment", { tenant: frm.doc.name, plan: frm.doc.plan, billing_period: frm.doc.billing_period, periods: 1, status: "Verified", method: "Bank transfer" }))
				.addClass("btn-primary");
		}
		frm.add_custom_button(__("Check usage and status now"), () =>
			frm.call("check_now").then(() => frm.reload_doc()), __("Plan"));
		if (frm.doc.site_host && ["Trial", "Active", "Payment due", "Suspended"].includes(frm.doc.status) && !["Waiting", "Running"].includes(frm.doc.data_reset)) {
			frm.add_custom_button(__("Start fresh (clear the trial data)"), () =>
				frappe.confirm(__("The workspace {0} is set up again with the same company, people and passwords. Everything else is cleared; the old one is kept as a backup on the server. Go ahead?", [frm.doc.site_host]),
					() => frm.call("fresh_start").then(() => { frappe.show_alert({ message: __("Fresh start queued. It takes a few minutes."), indicator: "green" }); frm.reload_doc(); })), __("Plan"));
		}
		if (frm.doc.status === "Failed") {
			frm.add_custom_button(__("Retry set-up"), () => frm.call("retry_setup").then(() => frm.reload_doc())).addClass("btn-primary");
		}
		const c = { Trial: "blue", Active: "green", "Payment due": "orange", Suspended: "red", Failed: "red", "Setting up": "yellow", Waiting: "yellow" }[frm.doc.status] || "gray";
		frm.page.set_indicator(__(frm.doc.status), c);
	},
});

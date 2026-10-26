// Buildiary Cloud Settings: test the outgoing email, and show this server's address for Google's relay.
frappe.ui.form.on("Buildiary Cloud Settings", {
	refresh(frm) {
		const M = "buildiary.buildiary_cloud.doctype.buildiary_cloud_settings.buildiary_cloud_settings.";
		frm.add_custom_button(__("Send test email"), () => {
			if (frm.is_dirty()) {
				frappe.msgprint(__("Save the settings first."));
				return;
			}
			frappe.prompt([{ fieldname: "to", fieldtype: "Data", options: "Email", label: __("Send to"), reqd: 1, default: frappe.session.user_email }],
				(v) => frappe.call({ method: M + "send_test_email", args: { to: v.to }, freeze: true, freeze_message: __("Sending…") }).then((r) => {
					const m = r.message || {};
					if (m.ok) frappe.msgprint({ title: __("Email works"), indicator: "green", message: __("A test email was sent to {0}. Check the inbox (and spam folder).", [m.to]) });
					else frappe.msgprint({ title: __("The email could not be sent"), indicator: "red",
						message: __("Check the Outgoing email settings and Google's SMTP relay (this server's address must be allowed).") + `<pre style="white-space:pre-wrap;font-size:11px;margin-top:10px">${frappe.utils.escape_html(m.error || "")}</pre>` });
				}), __("Send a test email"), __("Send"));
		}, __("Email"));
		frm.add_custom_button(__("This server's address"), () => {
			frappe.call({ method: M + "server_address", freeze: true }).then((r) => {
				frappe.msgprint({ title: __("This server's address"), message: r.message
					? __("Allow this address in Google's SMTP relay: {0}", [`<b style="font-size:1.2em">${frappe.utils.escape_html(r.message)}</b>`])
					: __("Could not find it just now.") });
			});
		}, __("Email"));
	},
});

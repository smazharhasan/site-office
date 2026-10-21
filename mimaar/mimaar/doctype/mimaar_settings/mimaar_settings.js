// Mimaar Settings: the AI key (typed here by the owner, kept encrypted on the server)
// and bringing the project's data across from the old Mimaar app.
frappe.ui.form.on("Mimaar Settings", {
	refresh(frm) {
		if (!frappe.user.has_role("System Manager")) return;
		frm.add_custom_button(__("Bring data from the old Mimaar app"), () => {
			frappe.confirm(
				__("Choose the data file exported from the old Mimaar app (mimaar-data.json). Items, budget, schedule, suppliers and payment plans are added; anything already here is left alone, so it is safe to do again."),
				() => mimaar.pick_file({ types: [".json", "application/json"] }).then((url) => {
					frappe.call({ method: "mimaar.migration.old_app.import_file", args: { file_url: url }, freeze: true }).then(() => {
						frappe.msgprint({ title: __("Started"), indicator: "blue", message: __("Bringing the data across. This takes a minute or two; a message appears here when it is done.") });
					});
				})
			);
		});
	},
});

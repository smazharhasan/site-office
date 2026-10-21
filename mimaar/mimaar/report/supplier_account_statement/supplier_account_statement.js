frappe.query_reports["Supplier Account Statement"] = {
	filters: [
		{ fieldname: "company", label: __("Company"), fieldtype: "Link", options: "Company", default: frappe.defaults.get_user_default("Company"), reqd: 1 },
		{ fieldname: "supplier", label: __("Supplier"), fieldtype: "Link", options: "Supplier", reqd: 1 },
		{ fieldname: "from_date", label: __("From"), fieldtype: "Date" },
		{ fieldname: "to_date", label: __("To"), fieldtype: "Date" },
	],
	onload(report) {
		const go = (share, how) => {
			const f = report.get_values(); if (!f || !f.supplier) return frappe.msgprint(__("Choose the supplier"));
			frappe.call({ method: "mimaar.api.supplier_statement_pdf", args: { supplier: f.supplier, from_date: f.from_date, to_date: f.to_date, share: share ? 1 : 0 }, freeze: true }).then(r => {
				const m = r.message || {};
				if (how === "pdf") return window.open(m.file_url);
				if (how === "wa") return mimaar.open_whatsapp(m);
				if (how === "mail") return mimaar.email_link(m, __("Account statement"));
			});
		};
		report.page.add_inner_button(__("PDF"), () => go(false, "pdf"), __("Send"));
		report.page.add_inner_button(__("WhatsApp"), () => go(true, "wa"), __("Send"));
		report.page.add_inner_button(__("Email"), () => go(true, "mail"), __("Send"));
	},
};

frappe.provide("frappe.treeview_settings");

frappe.treeview_settings["Account"] = {
	breadcrumb: "Accounts",
	title: __("Chart of Accounts"),
	get_tree_root: false,
	filters: [
		{
			fieldname: "company",
			fieldtype: "Select",
			options: erpnext.utils.get_tree_options("company"),
			label: __("Company"),
			render_on_toolbar: true,
			default: erpnext.utils.get_tree_default("company"),
			on_change: function () {
				var me = frappe.treeview_settings["Account"].treeview;
				var company = me.page.fields_dict.company.get_value();
				if (!company) {
					frappe.throw(__("Please set a Company"));
				}
				frappe.call({
					method: "erpnext.accounts.doctype.account.account.get_root_company",
					args: {
						company: company,
					},
					callback: function (r) {
						if (r.message) {
							let root_company = r.message.length ? r.message[0] : "";
							me.page.fields_dict.root_company.set_value(root_company);

							frappe.db.get_value(
								"Company",
								{ name: company },
								"allow_account_creation_against_child_company",
								(r) => {
									frappe.flags.ignore_root_company_validation =
										r.allow_account_creation_against_child_company;
								}
							);
						}
					},
				});
			},
		},
		{
			fieldname: "root_company",
			fieldtype: "Data",
			label: __("Root Company"),
			hidden: true,
			disable_onchange: true,
		},
	],
	root_label: "Accounts",
	get_tree_nodes: "erpnext.accounts.utils.get_children",
	on_get_node: function (nodes, deep = false) {
		if (frappe.boot.user.can_read.indexOf("GL Entry") == -1) return;

		let accounts = [];
		if (deep) {
			// in case of `get_all_nodes`
			accounts = nodes.reduce((acc, node) => [...acc, ...node.data], []);
		} else {
			accounts = nodes;
		}

		frappe.db.get_single_value("Accounts Settings", "show_balance_in_coa").then((value) => {
			if (value) {
				const get_balances = frappe.call({
					method: "erpnext.accounts.utils.get_account_balances",
					args: {
						accounts: accounts,
						company: cur_tree.args.company,
						include_default_fb_balances: true,
					},
				});

				get_balances.then((r) => {
					if (!r.message || r.message.length == 0) return;

					for (let account of r.message) {
						const node = cur_tree.nodes && cur_tree.nodes[account.value];
						if (!node || node.is_root) continue;

						// show Dr if positive since balance is calculated as debit - credit else show Cr
						const balance = account.balance_in_account_currency || account.balance;
						const dr_or_cr = balance > 0 ? __("Dr") : __("Cr");
						const format = (value, currency) => format_currency(Math.abs(value), currency);

						if (account.balance !== undefined) {
							node.parent && node.parent.find(".balance-area").remove();
							$(
								'<span class="balance-area pull-right">' +
									(account.balance_in_account_currency
										? format(
												account.balance_in_account_currency,
												account.account_currency
										  ) + " / "
										: "") +
									format(account.balance, account.company_currency) +
									" " +
									dr_or_cr +
									"</span>"
							).insertBefore(node.$ul);
						}
					}
				});
			}
		});
	},
	add_tree_node: "erpnext.accounts.utils.add_ac",
	menu_items: [
		{
			label: __("New Company"),
			action: function () {
				frappe.new_doc("Company", true);
			},
			condition: 'frappe.boot.user.can_create.indexOf("Company") !== -1',
		},
	],
	fields: [
		{
			fieldtype: "Data",
			fieldname: "account_name",
			label: __("New Account Name"),
			reqd: true,
			description: __(
				"Name of new Account. Note: Please don't create accounts for Customers and Suppliers"
			),
		},
		{
			fieldtype: "Data",
			fieldname: "account_number",
			label: __("Account Number"),
			description: __("Number of new Account, it will be included in the account name as a prefix"),
		},
		{
			fieldtype: "Check",
			fieldname: "is_group",
			label: __("Is Group"),
			description: __(
				"Further accounts can be made under Groups, but entries can be made against non-Groups"
			),
			onchange: function () {
				if (!this.value) {
					this.layout.set_value("root_type", "");
				}
			},
		},
		{
			fieldtype: "Select",
			fieldname: "root_type",
			label: __("Root Type"),
			options: ["Asset", "Liability", "Equity", "Income", "Expense"].join("\n"),
			depends_on: "eval:doc.is_group && !doc.parent_account",
		},
		{
			fieldtype: "Select",
			fieldname: "account_type",
			label: __("Account Type"),
			options: frappe.get_meta("Account").fields.filter((d) => d.fieldname == "account_type")[0]
				.options,
			description: __("Optional. This setting will be used to filter in various transactions."),
		},
		{
			fieldtype: "Link",
			fieldname: "account_category",
			label: __("Account Category"),
			options: frappe.get_meta("Account").fields.filter((d) => d.fieldname == "account_category")[0]
				.options,
			description: __("Optional. Used with Financial Report Template"),
		},
		{
			fieldtype: "Float",
			fieldname: "tax_rate",
			label: __("Tax Rate"),
			depends_on: 'eval:doc.is_group==0&&doc.account_type=="Tax"',
		},
		{
			fieldtype: "Link",
			fieldname: "account_currency",
			label: __("Currency"),
			options: "Currency",
			description: __("Optional. Sets company's default currency, if not specified."),
		},
	],
	ignore_fields: ["parent_account"],
	onload: function (treeview) {
		frappe.treeview_settings["Account"].treeview = {};
		$.extend(frappe.treeview_settings["Account"].treeview, treeview);
		function get_company() {
			return treeview.page.fields_dict.company.get_value();
		}

		// tools
		treeview.page.add_inner_button(
			__("Chart of Cost Centers"),
			function () {
				frappe.set_route("Tree", "Cost Center", { company: get_company() });
			},
			__("View"),
			"default",
			true
		);

		treeview.page.add_inner_button(
			__("Opening Invoice Creation Tool"),
			function () {
				frappe.set_route("Form", "Opening Invoice Creation Tool", { company: get_company() });
			},
			__("View"),
			"default",
			true
		);

		treeview.page.add_divider_to_button_group(__("View"));

		// financial statements
		for (let report of [
			"Trial Balance",
			"General Ledger",
			"Balance Sheet",
			"Profit and Loss Statement",
			"Cash Flow",
			"Accounts Payable",
			"Accounts Receivable",
		]) {
			treeview.page.add_inner_button(
				__(report),
				function () {
					frappe.set_route("query-report", report, { company: get_company() });
				},
				__("View")
			);
		}
	},
	post_render: function (treeview) {
		frappe.treeview_settings["Account"].treeview["tree"] = treeview.tree;
		if (treeview.can_create) {
			treeview.page.set_primary_action(
				__("New"),
				function () {
					let root_company = treeview.page.fields_dict.root_company.get_value();
					if (root_company) {
						frappe.throw(__("Please add the account to root level Company - {0}"), [
							root_company,
						]);
					} else {
						treeview.new_node();
					}
				},
				"add"
			);
		}
	},
	toolbar: [
		{
			label: __("Add Child"),
			condition: function (node) {
				return (
					frappe.boot.user.can_create.indexOf("Account") !== -1 &&
					(!frappe.treeview_settings[
						"Account"
					].treeview.page.fields_dict.root_company.get_value() ||
						frappe.flags.ignore_root_company_validation) &&
					node.expandable &&
					!node.hide_add
				);
			},
			click: function () {
				var me = frappe.views.trees["Account"];
				me.new_node();
			},
			btnClass: "hidden-xs",
		},
		{
			condition: function (node) {
				return !node.root && frappe.boot.user.can_read.indexOf("GL Entry") !== -1;
			},
			label: __("View Ledger"),
			click: function (node, btn) {
				frappe.route_options = {
					from_date: erpnext.utils.get_fiscal_year(frappe.datetime.get_today(), true)[1],
					to_date: erpnext.utils.get_fiscal_year(frappe.datetime.get_today(), true)[2],
					company:
						frappe.treeview_settings["Account"].treeview.page.fields_dict.company.get_value(),
				};
				if (node.parent_label) {
					frappe.route_options["account"] = node.label;
				}
				frappe.set_route("query-report", "General Ledger");
			},
			btnClass: "hidden-xs",
		},
		{
			label: __("Delete"),
			condition: function (node) {
				return !node.root && frappe.boot.user.can_delete.indexOf("Account") !== -1;
			},
			click: function (node) {
				// Get related transactions before delete
				frappe.call({
					method: "erpnext.accounts.doctype.account.account.get_related_transactions",
					args: {
						name: node.label
					},
					callback: function (r) {
						if (!r.exc) {
							var related_transactions = r.message;
							var has_related_transactions = related_transactions.gl_entry_count > 0 || related_transactions.transactions.length > 0;
							
							if (has_related_transactions) {
								// Show related transactions dialog
								var transactions_html = "";
								
								// Add GL Entry count
							if (related_transactions.gl_entry_count > 0) {
								var today = new Date();
								var tenYearsAgo = new Date();
								tenYearsAgo.setFullYear(today.getFullYear() - 10);
								var tenYearsLater = new Date();
								tenYearsLater.setFullYear(today.getFullYear() + 10);
								
								var tenYearsAgoStr = tenYearsAgo.toISOString().split('T')[0];
								var tenYearsLaterStr = tenYearsLater.toISOString().split('T')[0];
								
								transactions_html += `
									<div class="form-group">
										<label class="control-label">总账条目</label>
										<div class="form-control-static">
											<a href="/app/query-report/General%20Ledger?account=${encodeURIComponent(node.label)}&from_date=${tenYearsAgoStr}&to_date=${tenYearsLaterStr}&show_cancelled_entries=1" target="_blank" style="color: #337ab7; text-decoration: underline; font-weight: 500;">
												${related_transactions.gl_entry_count} 条记录
											</a>
										</div>
									</div>
								`;
							}
								
								// Add other transactions
								if (related_transactions.transactions.length > 0) {
									related_transactions.transactions.forEach(function (transaction) {
										let route = transaction.route;
										let transaction_type = "";
										
										// Add filter for account and translate transaction type
											if (transaction.type === "Sales Invoice") {
												route += `?debit_to=${encodeURIComponent(node.label)}`;
												transaction_type = "销售发票";
											} else if (transaction.type === "Purchase Invoice") {
												route += `?credit_to=${encodeURIComponent(node.label)}`;
												transaction_type = "采购发票";
											} else if (transaction.type === "Journal Entry") {
												route += `?account=${encodeURIComponent(node.label)}`;
												transaction_type = "日记账";
											} else if (transaction.type === "Payment Entry") {
												route += `?account=${encodeURIComponent(node.label)}`;
												transaction_type = "收付款凭证";
											} else if (transaction.type === "Payment Ledger Entry") {
												route += `?account=${encodeURIComponent(node.label)}`;
												transaction_type = "收付款台账";
											}
										
										transactions_html += `
											<div class="form-group">
												<label class="control-label">${transaction_type}</label>
												<div class="form-control-static">
													<a href="${route}" target="_blank" style="color: #337ab7; text-decoration: underline; font-weight: 500;">
														${transaction.count} 条记录
													</a>
												</div>
											</div>
										`;
									});
								}
								
								// Create information dialog (no delete button)
								var d = new frappe.ui.Dialog({
									title: __("科目关联交易信息"),
									fields: [
										{
											label: __("科目"),
											fieldname: "account",
											fieldtype: "Data",
											default: node.label,
											read_only: 1
										},
										{
											label: __("关联交易"),
											fieldname: "related_transactions",
											fieldtype: "HTML",
											options: transactions_html
										},
										{
											label: __("该科目存在关联交易，无法删除。请点击上方链接查看详细信息。"),
											fieldname: "message",
											fieldtype: "HTML",
											options: "<div class='alert alert-warning' style='margin-top: 15px;'>该科目存在关联交易，无法删除。请点击上方链接查看详细信息。</div>"
										}
									],
									primary_action_label: __("关闭"),
									primary_action: function () {
										d.hide();
									}
								});
								d.show();
							} else {
								// No related transactions, proceed with normal delete
								frappe.model.delete_doc("Account", node.label, function () {
									node.parent.remove();
								});
							}
						}
					}
				});
			},
			btnClass: "hidden-xs",
		},
	],
	extend_toolbar: true,
};

"use strict";

function app_start() {
	TemplateJS.View.lightbox_class = "lightbox";
	window.app = new App();
	window.app.init();
	
}

function parse_fetch_error(e) {
	var txt;
	if (e.headers) {
		var ct = e.headers.get("Content-Type");
		if (ct == "text/html" || ct == "application/xhtml+xml") {
			txt = e.text().then(function(text) {
			 	var parser = new DOMParser();
				var htmlDocument = parser.parseFromString(text, ct);
				var el = htmlDocument.body.querySelector("p");
				if (!el) el = htmlDocument.body;
				return el.innerText;
			});
		} else {
			txt = e.text() || "";
		}
	} else {
		txt = Promise.resolve(e.toString());
	}	
	return txt.then(function(t) {
			var msg = (e.status || "")+" "+(e.statusText || "");
			if (t == msg) t = "";
			return {msg:msg, t:t};
	});
} 

function fetch_error(e) {
	if (!fetch_error.shown) {
		fetch_error.shown = true;
		parse_fetch_error(e).then(function(t) {
			if (e.status == 401) {
				var txts = document.getElementById("strtable");
				app.dlgbox({text: txts.dataset.please_login},"network_error").then(function() {
					fetch_error.shown = false;
				});
			} else {
				app.dlgbox({text:t.msg, desc:t.t},"network_error").then(function() {
					fetch_error.shown = false;
				});
			}
		});
	}
	throw e;	
}

function fetch_with_error(url, opt) {
	return fetch_json(url, opt).catch(fetch_error);
}

function App() {	
	this.traders={};
	this.config={};
	this.curForm = null;
	this.advanced = false;
}

TemplateJS.View.prototype.showWithAnim = function(item, state) {	
	var elem = this.findElements(item)[0];
	var h = elem.classList.contains("hidden") || elem.hidden;
	if (state) {
		if (h) {
			elem.hidden = false;
			TemplateJS.waitForDOMUpdate().then(function(x) {
				elem.classList.remove("hidden");
			});
		}
	} else {
		if (!h) {
			elem.classList.add("hidden");
			var anim = new TemplateJS.Animation(elem);
			anim.wait().then(function(x) {
				if (elem.classList.contains("hidden")) 
					elem.hidden = true;
			});
		}
	}
}


App.prototype.createTraderForm = function() {
	var form = TemplateJS.View.fromTemplate("trader_form");
	var norm=form.findElements("goal_norm")[0];
	var pl = form.findElements("goal_pl")[0];
	form.dlgRules = function() {
		var state = this.readData(["strategy","advanced","check_unsupp"]);
		form.showItem("strategy_halfhalf",state.strategy == "halfhalf" || state.strategy == "keepvalue");
		form.showItem("strategy_pl",state.strategy == "plfrompos");
		form.showItem("kv_valinc_h",state.strategy == "keepvalue");
		form.setData({"help_goal":{"class":state.strategy}});
		form.getRoot().classList.toggle("no_adv", !state["advanced"]);
		form.getRoot().classList.toggle("no_experimental", !state["check_unsupp"]);
		
	};
	form.setItemEvent("strategy","change", form.dlgRules.bind(form));
	form.setItemEvent("advanced","change", form.dlgRules.bind(form));
	form.setItemEvent("check_unsupp","change", form.dlgRules.bind(form));
	return form;
}

App.prototype.createTraderList = function(form) {
	if (!form) form = TemplateJS.View.fromTemplate("trader_list");
	var items = Object.keys(this.traders).map(function(x) {
		return {
			image:this.brokerImgURL(this.traders[x].broker),
			caption: this.traders[x].title,
			broker: this.traders[x].broker,
			id: this.traders[x].id,			
		};
	},this);
	items.sort(function(a,b) {
		return a.broker.localeCompare(b.broker);
	});
	items.unshift({
		"image":"../res/options.png",
		"caption":this.strtable.options,				
		"id":"$"
		
	})
	items.unshift({
		"image":"../res/security.png",
		"caption":this.strtable.access_control,				
		"id":"!"
		
	})
	items.push({
		"image":"../res/add_icon.png",
		"caption":"",				
		"id":"+"
	});
	items.forEach(function(x) {
		x[""] = {"!click":function(id) {
			form.select(id);
		}.bind(null,x.id)}
	});
	form.setData({"item": items});
	form.select = function(id) {
		var update = items.map(function(x) {
			return {"":{"classList":{"selected": x.id == id}}};
		});
		form.setData({"item": update});
		
		var nf;
		if (id == "!") {
			if (this.curForm) {
				this.curForm.save();				
				this.curForm = null;
			}
			nf = this.securityForm();
			this.desktop.setItemValue("content", nf);
			nf.save = function() {};

		} else if (id == '$') {
			if (this.curForm) {
				this.curForm.save();				
				this.curForm = null;
			}
			nf = this.optionsForm();
			this.desktop.setItemValue("content", nf);
			this.curForm = nf;
			
		} else if (id == "+") {
			this.brokerSelect().then(this.pairSelect.bind(this)).then(function(res) {
				var broker = res[0];
				var pair = res[1];
				var name = res[2];				
				if (!this.traders[name]) this.traders[name] = {};
				var t = this.traders[name];
				t.broker = broker;
				t.pair_symbol = pair;
				t.id = name;
				t.enabled = true;
				t.dry_run = false;
				if (!t.title) t.title = pair;
				this.updateTopMenu(name);
			}.bind(this))
		} else {
			if (this.curForm) {
				this.curForm.save();				
				this.curForm = null;
			}

			nf = this.openTraderForm(id);			

			this.desktop.setItemValue("content", TemplateJS.View.fromTemplate("main_form_wait"));
			
			nf.then(function (nf) {
				this.desktop.setItemValue("content", nf);
				this.curForm = nf;
				this.curForm.save = function() {
					this.traders[id] = this.saveForm(nf, this.traders[id]);
					this.updateTopMenu();
				}.bind(this);
				this.curTrader = this.traders[id];
			}.bind(this));
		}
	}.bind(this);
	
	return form;
}

App.prototype.processConfig = function(x) {	
	this.config = x;
	this.users = x["users"] || [];
	this.traders = x["traders"] || {}
	for (var id in this.traders) this.traders[id].id = id;
	return x;	
}

App.prototype.loadConfig = function() {
	return fetch_with_error("api/config").then(this.processConfig.bind(this));
}

App.prototype.brokerURL = function(broker) {
	return "api/brokers/"+encodeURIComponent(broker);
}
App.prototype.pairURL = function(broker, pair) {
	return this.brokerURL(broker) + "/pairs/" + encodeURIComponent(pair);	
}
App.prototype.brokerImgURL = function(broker) {
	return this.brokerURL(broker) + "/icon.png";	
}
App.prototype.traderURL = function(trader) {
	return "api/traders/"+encodeURIComponent(trader);
}
App.prototype.traderPairURL = function(trader, pair) {
	return "api/traders/"+encodeURIComponent(trader)+"/broker/pairs/" + encodeURIComponent(pair);	
}

function defval(v,w) {
	if (v === undefined) return w;
	else return v;
}

function filledval(v,w) {
	if (v === undefined) return {value:w};
	else if (v == w) return {value:v};
	else {
		return {
			"value":v,
			"classList":{
				"changed":true
			}
		}
	}
}



function calc_range(a, ea, c, p, inv, leverage) {
	a = a+ea;
	var value = a * p;
	var max_price = pow2((a * Math.sqrt(p))/ea);
	var S = value - c
	var min_price = S<=0?0:pow2(S/(a*Math.sqrt(p)));
	if (leverage) {
		var colateral = c* (1 - 1 / leverage); 
		min_price = (ea*p - 2*Math.sqrt(ea*colateral*p) + colateral)/ea;
		max_price = (ea*p + 2*Math.sqrt(ea*colateral*p) + colateral)/ea;

	}
	if (!isFinite(max_price)) max_price = "∞";
	if (inv) {
		var k = 1/min_price;
		min_price = 1/max_price;
		max_price =k;
	}
	return {
		range_min_price: adjNumN(min_price),
		range_max_price: adjNumN(max_price)
	}

	
}

App.prototype.fillForm = function (src, trg) {
	var data = {};	
	data.id = src.id;
	data.title = src.title;
	data.symbol = src.pair_symbol;	
	if (!this.fillFormCache) this.fillFormCache = {} 
	
	
	var apikey = this.config.apikeys && this.config.apikeys[src.broker];

	var updateHdr = function(){
		var state = fetch_json("api/editor",{
			method:"POST",
			body: JSON.stringify({
				broker: src.broker,
				trader: src.id,
				pair: src.pair_symbol
			})
		});
		state.then(function(st) {
			var data = {};
			fillHeader(st,data);
			trg.setData(data);
		},function(err) {
			var ep = parse_fetch_error(err);
			ep.then(function(x) {
				trg.setData({
					err_failed_to_fetch:{
						value:x.msg+" - "+x.t,
						classList:{
							mark:true
						}
					},
					broker:"error"
				});
			});
		});			
	}.bind(this);
	
	var fillHeader = function(state, data) {
				
	
		var broker = state.broker;
		var pair = state.pair;
		var orders = state.orders;
		this.fillFormCache[src.id] = state;

		data.broker = broker.exchangeName;
		data.no_api_key = {".hidden": !!(apikey === undefined?broker.trading_enabled:apikey)};
		data.api_key_not_saved = {".hidden": apikey === undefined || !(!broker.trading_enabled && apikey)};
		data.broker_id = broker.name;
		data.broker_ver = broker.version;
		data.asset = pair.asset_symbol;
		data.currency = pair.currency_symbol;
		data.balance_asset= adjNum(invSize(pair.asset_balance,pair.invert_price));
		data.balance_currency = adjNum(pair.currency_balance);
		data.price= adjNum(invPrice(pair.price,pair.invert_price));
		data.leverage=pair.leverage?pair.leverage+"x":"n/a";

		var mp = orders?orders.map(function(z) {
			return {
				id: z.id,
				dir: invSize(z.size,pair.invert_price)>0?"BUY":"SELL",
				price:adjNum(invPrice(z.price, pair.invert_price)),
				size: adjNum(Math.abs(z.size))
			};}):[];

		if (mp.length) {
			var butt = document.createElement("button");
			butt.innerText="X";
			mp[0].action = {
					"rowspan":mp.length,
					"value": butt
			};
			butt.addEventListener("click", this.cancelAllOrders.bind(this, src.id));
		}
		
		data.orders = mp

		var fields = []

		function fill_recursive(path, node) {
			if (node === undefined) return;
			if (typeof node == "object") {
				if (node === null) return;
				Object.keys(node).forEach(function(k) {
					fill_recursive(path.concat(k), node[k]);
				});
			} else {
				fields.push({
					key: path.join("."),
					value: node.toString()
				});
			}
		}
		if (state.strategy) fill_recursive([],state.strategy);

		data.strategy_fields = fields;
		data.icon_broker = {
					".hidden":!broker.settings,
					"!click":this.brokerConfig.bind(this, src.broker, src.pair_symbol)
				}					
		data.open_orders_sect = {".hidden":!mp.length};

		function linStrategy_recalc() {
			var fdata = {};
			var inputs = trg.readData(["max_pos","cstep","neutral_pos"]);
			var pos = invSize(pair.asset_balance,pair.invert_price) - inputs.neutral_pos;
			var k = inputs.cstep / (pair.price*pair.price * 0.01);
			var mp = pair.price - pos/k;
			var lp = mp-inputs.max_pos/k;
			fdata.linear_max_in_pos = adjNum(0.5*k*(mp - lp)*(mp - lp));
			var minp = -inputs.max_pos/k+mp;
			var maxp = +inputs.max_pos/k+mp;
			if (pair.invert_price) {
				fdata.linear_max_price = minp<0?"∞":adjNum(1/minp);
				fdata.linear_min_price = adjNum(1/maxp);
			} else {
				fdata.linear_min_price = adjNum(minp);
				fdata.linear_max_price = maxp<0?"∞":adjNum(maxp);				
			}
			fdata.err_toolargepos = {classList:{mark:pos > safe_pos}};
			fdata.err_invalid_values = {classList:{mark:inputs.cstep<=0 || inputs.max_pos<0}};

			trg.setData(fdata);
			var safe_pos = pair.currency_balance / pair.price;
			trg.forEachElement("err_toolargepos", function(b,x) 
				{x.classList.toggle("mark",b);}.bind(null, pos > safe_pos) );
		}
		function linStrategy_recomended() {
			var inputs = trg.readData(["cstep","neutral_pos","pl_baluse"]);
			var value = pair.currency_balance*inputs.pl_baluse*0.01;
			var invest = value / 20;
			var k = invest / (pair.price*pair.price * 0.01);
			var max_pos = Math.sqrt(k * value);
			trg.setData({
				cstep : adjNumN(invest),
				max_pos: adjNumN(max_pos)
			});

			linStrategy_recalc();
		}
		function linStrategy_recomended_maxpos() {			
			var inputs = trg.readData(["cstep","neutral_pos","pl_baluse"]);
			var value = pair.currency_balance*inputs.pl_baluse*0.01;
			var invest = inputs.cstep;
			var k = invest / (pair.price*pair.price * 0.01);
			var max_pos = Math.sqrt(k * value);
			trg.setData({
				max_pos: adjNumN(max_pos)
			});
			linStrategy_recalc();
		}

		function halfHalf_recalc() {
			var inputs = trg.readData(["strategy","acum_factor","external_assets"]);
			var p = pair.price;
			var ea = inputs.external_assets;
			var data = {};
			var a = pair.asset_balance+ea;
			if (inputs.strategy == "halfhalf") {				
				var s = a * p - pair.currency_balance;				
				if (pair.invert_price) {
					data.halfhalf_max_price = adjNum(s <0?"∞":p/((s/a)*(s/a)));
					data.halfhalf_min_price = ea <= 0?0:adjNum((ea*ea)/(p*a*a));
				} else {
					data.halfhalf_max_price = ea <= 0?"∞":adjNum(p*a*a/(ea*ea));
					data.halfhalf_min_price = adjNum(s <0?0:(s/a)*(s/a)/p);
				}
			} else {
				var k = p*a;
				if (pair.invert_price) {
				    data.halfhalf_min_price = ea > 0?adjNum(ea/k):0;
				    data.halfhalf_max_price = adjNum(1.0/(p*Math.exp(-pair.currency_balance/k)));
				} else {
				    data.halfhalf_min_price = adjNum(p*Math.exp(-pair.currency_balance/k));
				    data.halfhalf_max_price = ea > 0?adjNum(k/ea):"∞";
				}
			}

			data.err_external_assets = {classList:{mark:!pair.leverage && !pair.invert_price && a <= 0}};
			data.err_external_assets_margin = {classList:{mark:pair.leverage && !pair.invert_price && a <= 0}};
			data.err_external_assets_inverse = {classList:{mark:pair.invert_price && a <= 0}};
			data.external_assets_hint = -pair.asset_balance;
			trg.setData(data);
			
		}
		function linStrategy_recalc_power() {
			var v = trg.readData(["pl_power","pl_confmode","pl_baluse"]);
			if (v.pl_confmode == "m") return;
			var m = Math.pow(10,v.pl_power)*0.01;
			trg.setData({"pl_show_factor":adjNumN(m),
						"cstep":pair.currency_balance*m*v.pl_baluse*0.01});
			
			linStrategy_recomended_maxpos();
		}
		
		function calcPosition(data) {
			var v = trg.readData(["neutral_pos","report_position_offset"]);
			var cpos = invSize((isFinite(v.report_position_offset)?v.report_position_offset:0) + state.position,pair.invert_price);
			if (isFinite(cpos)) {
				var apos = invSize(pair.asset_balance, pair.invert_price) - v.neutral_pos;
				data.hdr_position = adjNum(cpos);
				data.sync_pos = {
						".hidden":(Math.abs(cpos - apos) <= (Math.abs(cpos)+Math.abs(apos))*1e-8)
				};
			} else {
				data.hdr_position = adjNum();
				data.sync_pos = {};
			}
		}

		data.max_pos = data.cstep = data.neutral_pos = {"!input": linStrategy_recalc};
		data.linear_suggest = {"!click":linStrategy_recomended};
		data.linear_suggest_maxpos = {"!click":linStrategy_recomended_maxpos};
		data.external_assets = {"!input": halfHalf_recalc};
		data.vis_spread = {"!click": this.init_spreadvis.bind(this, trg, src.id)};
		linStrategy_recalc();
		halfHalf_recalc();
		linStrategy_recalc_power();
		var tmp = trg.readData(["cstep","max_pos"]);
		if (!tmp.max_pos && !tmp.cstep) linStrategy_recomended();
		data.pl_baluse = data.pl_power={"!input":function() {
			linStrategy_recalc_power();
		}};
		data.pl_confmode = {"!change":function() {
			trg.showItem("pl_mode_m", this.value == "m");
			trg.showItem("pl_mode_a", this.value == "a");
		}};
		calcPosition(data);
		data.sync_pos["!click"] = function() {
			var data = {};
			var v = trg.readData(["neutral_pos","report_position_offset"]);
			var s = pair.asset_balance - invSize(v.neutral_pos, pair.invert_price) - state.position;
			trg.setData({report_position_offset:s});
			calcPosition(data);
			trg.setData(data);
		}
		trg.forEachElement("neutral_pos",function(x) {
			x.parentNode.classList.toggle("adv", pair.leverage != 0);
		});
		
		
	}.bind(this);
	
	if (this.fillFormCache[src.id]) {
	setTimeout(function() {
			var data= {};
			fillHeader(this.fillFormCache[src.id], data);
			trg.setData(data);
	}.bind(this),1);
	}
	data.broker_img = this.brokerImgURL(src.broker);
	data.advanced = this.advanced;

	
	data.strategy = (src.strategy && src.strategy.type) || "";
	data.cstep = 0;
	data.neutral_pos = 0;
	data.pl_acum = 0;
	data.acum_factor = 0;
	data.external_assets = 0;
	data.pl_mode_m = {".hidden":true};
	data.pl_power=1;
	data.pl_show_factor=0.1;
	data.pl_baluse=50;
	data.pl_redfact=50;
	data.pl_redmode="fixed";
	data.kv_valinc = 0;
	
	if (data.strategy == "halfhalf" || data.strategy == "keepvalue") {
		data.acum_factor = filledval(defval(src.strategy.accum,0)*100,0);
		data.external_assets = filledval(src.strategy.ea,0);
		data.kv_valinc = filledval(src.strategy.valinc,0);
	} else if (data.strategy == "plfrompos") {
		data.pl_acum = filledval(defval(src.strategy.accum,0)*100,0);
		data.neutral_pos = filledval(src.strategy.neutral_pos,0);		
		data.cstep = filledval(src.strategy.cstep,0);
		data.max_pos = filledval(src.strategy.maxpos,0);
		data.pl_redfact = filledval(defval(Math.abs(src.strategy.reduce_factor),0.5)*100,50);
		data.pl_redmode = filledval(defval(src.strategy.fixed_reduce,src.strategy.reduce_factor<0)?"fixed":"rp");
		data.pl_baluse = filledval(defval(src.strategy.balance_use,1)*100,100);
		data.pl_confmode= filledval(src.strategy.power?"a":"m", "a");
		data.pl_power=filledval(src.strategy.power?src.strategy.power:1,1);
		data.pl_mode_m = {".hidden":!!src.strategy.power};
		data.pl_mode_a = {".hidden":!src.strategy.power};
		data.pl_show_factor=Math.pow(10,defval(src.strategy.power,1))*0.01;
	}
	data.enabled = src.enabled;
	data.dry_run = src.dry_run;
	data.accept_loss = filledval(src.accept_loss,1);
	data.spread_calc_stdev_hours = filledval(src.spread_calc_stdev_hours,4);
	data.spread_calc_sma_hours = filledval(src.spread_calc_sma_hours,24);
	data.dynmult_raise = filledval(src.dynmult_raise,250);
	data.dynmult_fall = filledval(src.dynmult_fall, 5);
	data.dynmult_mode = filledval(src.dynmult_mode, "half_alternate");
	data.dynmult_scale = filledval(defval(src.dynmult_scale,true)?1:0,1);
	data.spread_mult = filledval(Math.log(defval(src.buy_step_mult,1))/Math.log(2)*100,0);
	data.order_mult = filledval(defval(src.buy_mult,1)*100,100);
	data.min_size = filledval(src.min_size,0);
	data.max_size = filledval(src.max_size,0);
	data.internal_balance = filledval(src.internal_balance,0);
	data.dust_orders = filledval(src.dust_orders,true);
	data.detect_manual_trades = filledval(src.detect_manual_trades,false);
	data.report_position_offset = filledval(src.report_position_offset,0);
	data.force_spread = filledval(adjNum((Math.exp(defval(src.force_spread,0))-1)*100),"0.000");
	data.max_balance = filledval(src.max_balance,"");
	data.min_balance = filledval(src.min_balance,"");
		

	
	
	data.icon_repair={"!click": this.repairTrader.bind(this, src.id)};
	data.icon_reset={"!click": this.resetTrader.bind(this, src.id)};
	data.icon_delete={"!click": this.deleteTrader.bind(this, src.id)};
	data.icon_undo={"!click": this.undoTrader.bind(this, src.id)};
	data.icon_trading={"!click":this.tradingForm.bind(this, src.id)};
	
	function refresh_hdr() {
		if (trg.getRoot().isConnected) {
			updateHdr();
			setTimeout(refresh_hdr,60000);
		}
	}

	function unhide_changed(x) {


		
		var root = trg.getRoot();
		var items = root.getElementsByClassName("changed");
		Array.prototype.forEach.call(items,function(x) {
			while (x && x != root) {
				x.classList.add("unhide");
				x = x.parentNode;
			}
		});

		var inputs = trg.getRoot().querySelectorAll("input,select");
		Array.prototype.forEach.call(inputs, function(x) {
			function markModified() {
				var n = this;
				while (n && n != trg.getRoot())  {
					n.classList.add("modified");
					n = n.parentNode;
				}
			}
			x.addEventListener("change", markModified );
		});	

		refresh_hdr();

		
		
		return x;
	}


	return trg.setData(data).catch(function(){}).then(unhide_changed.bind(this)).then(trg.dlgRules.bind(trg));
}


App.prototype.saveForm = function(form, src) {

	var data = form.readData();
	var trader = {}
	var goal = data.goal;
	trader.strategy = {};
	trader.strategy.type = data.strategy;
	if (data.strategy == "plfrompos") {
		trader.strategy.accum = data.pl_acum/100.0;
		trader.strategy.cstep = data.cstep;
		trader.strategy.neutral_pos = data.neutral_pos;
		trader.strategy.maxpos = data.max_pos;
		trader.strategy.reduce_factor = data.pl_redfact/100;
		trader.strategy.fixed_reduce = data.pl_redmode=="fixed";
		trader.strategy.balance_use = data.pl_baluse/100;
		trader.strategy.power = data.pl_confmode=="a"?data.pl_power:0;
	} else if (data.strategy == "halfhalf" || data.strategy == "keepvalue") {
		trader.strategy.accum = data.acum_factor/100.0;
		trader.strategy.ea = data.external_assets;
		trader.strategy.valinc = data.kv_valinc;
	}
	trader.id = src.id;
	trader.broker =src.broker;
	trader.pair_symbol = src.pair_symbol;
	trader.title = data.title;
	trader.enabled = data.enabled;
	trader.dry_run = data.dry_run;
	this.advanced = data.advanced;
	trader.accept_loss = data.accept_loss;
	trader.spread_calc_stdev_hours =data.spread_calc_stdev_hours ;
	trader.spread_calc_sma_hours  = data.spread_calc_sma_hours;
	trader.dynmult_raise = data.dynmult_raise;
	trader.dynmult_fall = data.dynmult_fall;
	trader.dynmult_mode = data.dynmult_mode;
	trader.dynmult_scale = data.dynmult_scale == "1"; 
	trader.buy_mult = data.order_mult/100;
	trader.sell_mult = data.order_mult/100;
	trader.buy_step_mult = Math.pow(2,data.spread_mult*0.01)
	trader.sell_step_mult = Math.pow(2,data.spread_mult*0.01)
	trader.min_size = data.min_size;
	trader.max_size = data.max_size;
	trader.internal_balance = data.internal_balance;
	trader.dust_orders = data.dust_orders;
	trader.detect_manual_trades = data.detect_manual_trades;
	trader.report_position_offset = data.report_position_offset;
	trader.force_spread = Math.log(data.force_spread/100+1);
	if (isFinite(data.min_balance)) trader.min_balance = data.min_balance;
	if (isFinite(data.max_balance)) trader.max_balance = data.max_balance;
	return trader;
	
}

App.prototype.openTraderForm = function(trader) {
	var form = this.createTraderForm();
	var p = this.fillForm(this.traders[trader], form);
	return Promise.resolve(form);	
}


App.prototype.init = function() {
	this.strtable = document.getElementById("strtable").dataset;
	this.desktop = TemplateJS.View.createPageRoot(true);
	this.desktop.loadTemplate("desktop");
	var top_panel = TemplateJS.View.fromTemplate("top_panel");
	this.top_panel = top_panel;
	this.desktop.setItemValue("top_panel", top_panel);
	top_panel.setItemEvent("save","click", this.save.bind(this));
	top_panel.setItemEvent("login","click", function() {
		location.href="api/login";
	});
	
	
	return this.loadConfig().then(function() {
		top_panel.showItem("login",false);
		top_panel.showItem("save",true);
		var menu = this.createTraderList();
		this.menu =  menu;
		this.desktop.setItemValue("menu", menu);
		this.stopped = {};
		
		
	}.bind(this));
	
}

App.prototype.brokerSelect = function() {
	var _this = this;
	return new Promise(function(ok, cancel) {
		
		var form = TemplateJS.View.fromTemplate("broker_select");
		_this.waitScreen(fetch_with_error("api/brokers/_all")).then(function(x) {
			form.openModal();
			var show_excl = false;
			var lst = x.map(function(z) {
				var e = _this.config.apikeys && _this.config.apikeys[z];
				var ex = e !== undefined || z.trading_enabled;
				show_excl = show_excl || !ex;
				return {
					excl_info: {".hidden":ex},
					image:_this.brokerImgURL(z.name),
					capiton: z.name,
					"":{"!click": function() {
							form.close();
							ok(z.name);
						}}
				};
			});
			form.setData({
				"item":lst,
				"excl_info": {".hidden": !show_excl},
			});
			form.setCancelAction(function() {
				form.close();
				cancel();
			},"cancel");

		});
	});
}

App.prototype.pairSelect = function(broker) {
	var _this = this;
	return new Promise(function(ok, cancel) {
		var form = TemplateJS.View.fromTemplate("broker_pair");
		form.openModal();
		form.setCancelAction(function() {
			form.close();
			cancel();
		},"cancel");
		form.setDefaultAction(function() {
			form.close();
			var d = form.readData();
			if (!d.pair || !d.name) return;
			var name = d.name.replace(/[^-a-zA-Z0-9_.~]/g,"_");
			ok([broker, d.pair, name]);
		},"ok");
		fetch_with_error(_this.pairURL(broker,"")).then(function(data) {
			var pairs = [{"":{"value":"----",".value":""}}].concat(data["entries"].map(function(x) {
				return {"":{"value":x,".value":x}};
			}));			
			form.setItemValue("item",pairs);
			form.showItem("spinner",false);
			dlgRules();
		},function() {form.close();cancel();});
		form.setItemValue("image", _this.brokerImgURL(broker));
		var last_gen_name="";
		function dlgRules() {
			var d = form.readData(["pair","name"]);
			if (d.name == last_gen_name) {
				d.name = last_gen_name = broker+"_"+d.pair;
				form.setItemValue("name", last_gen_name);
			}
			form.enableItem("ok", d.pair != "" && d.name != "");			
		};
		
		
		form.setItemEvent("pair","change",dlgRules);
		form.setItemEvent("name","change",dlgRules);
		dlgRules();
	});
	
}

App.prototype.updateTopMenu = function(select) {
	this.createTraderList(this.menu);
	if (select) this.menu.select(select);
}

App.prototype.waitScreen = function(promise) {	
	var d = TemplateJS.View.fromTemplate('waitdlg');
	d.openModal();
	return promise.then(function(x) {
		d.close();return x;
	}, function(e) {
		d.close();throw e;
	});
}

App.prototype.cancelAllOrdersNoDlg = function(id) { 	

		var tr = this.traders[id];
		var cr = fetch_with_error(
			this.traderPairURL(id, tr.pair_symbol)+"/orders",
			{method:"DELETE"});
		var dr = fetch_json(
			this.traderURL(tr.id)+"/stop",
			{method:"POST"}).catch(function() {});


		return this.waitScreen(Promise.all([cr,dr]))
			.catch(function(){})
			.then(function() {
				this.stopped[id] = true;				
			}.bind(this));

													
}

App.prototype.deleteTrader = function(id) {
	return this.dlgbox({"text":this.strtable.askdelete},"confirm").then(function(){
			this.curForm.close();
			delete this.traders[id];
			this.updateTopMenu();
			this.curForm = null;
	}.bind(this));
}

App.prototype.undoTrader = function(id) {
	this.curForm.close();
	this.curForm = null;
	this.updateTopMenu(id);
}

App.prototype.resetTrader = function(id) {
	this.dlgbox({"text":this.strtable.askreset,
		"ok":this.strtable.yes,
		"cancel":this.strtable.no},"confirm").then(function(){

		var tr = this.traders[id];
		this.waitScreen(fetch_with_error(
			this.traderURL(tr.id)+"/reset",
			{method:"POST"})).then(function() {				
						this.updateTopMenu(tr.id);				
			}.bind(this));
	}.bind(this));
}

App.prototype.repairTrader = function(id) {
		this.dlgbox({"text":this.strtable.askrepair,
		"ok":this.strtable.yes,
		"cancel":this.strtable.no},"confirm").then(function(){

		var tr = this.traders[id];
		this.waitScreen(fetch_with_error(
			this.traderURL(tr.id)+"/repair",
			{method:"POST"})).then(function() {
						this.updateTopMenu(tr.id);				
			}.bind(this));
	}.bind(this));
}

App.prototype.cancelAllOrders = function(id) {
	return this.dlgbox({"text":this.strtable.askcancel,
		"ok":this.strtable.yes,
		"cancel":this.strtable.no},"confirm").then(this.cancelAllOrdersNoDlg.bind(this,id))
			.then(function() {
						this.updateTopMenu(id);
					}.bind(this));

}

App.prototype.addUser = function() {
	return new Promise(function(ok,cancel) {
		var dlg = TemplateJS.View.fromTemplate("add_user_dlg");
		dlg.openModal();
		dlg.setCancelAction(function(){
			dlg.close();
			cancel();
		},"cancel");
		dlg.setDefaultAction(function(){
			dlg.close();
			var data = dlg.readData();
			var dlg2 = TemplateJS.View.fromTemplate("password_dlg");
			dlg2.openModal();
			dlg2.setData(data);
			dlg2.setCancelAction(function() {
				dlg2.close();
				cancel();
			},"cancel");
			dlg2.setDefaultAction(function() {
				dlg2.unmark();
				var data2 = dlg2.readData();
				if (data2.pwd == "" ) return
				if (data2.pwd2 == "" ) {
					dlg2.findElements("pwd2")[0].focus();
					return;
				}
				if (data2.pwd  != data2.pwd2) {
					dlg2.mark("errpwd");
				} else {
					ok({
						username:data.username,
						password:data2.pwd,
						comment:data.comment
					});
					dlg2.close();
				}				
			},"ok");
		},"ok");
	});
}


App.prototype.securityForm = function() {
	var form = TemplateJS.View.fromTemplate("security_form");
	
	function dropUser(user, text){		
		this.dlgbox({"text": text+user}, "confirm").then(function() {
			this.users = this.users.filter(function(z) {
				return z.username != user;
			});
			update.call(this);
		}.bind(this));
	}
	
	
	function update() {
		
		var rows = this.users.map(function(x) {
			var that = this;
			return {
				user:x.username,
				role:{
					"value":x.admin?"admin":"viewer",
					"!change": function() {
						x.admin = this.value == "admin"
					}
				},
				comment:x.comment,
				drop:{"!click":function() {
					dropUser.call(that, x.username, this.dataset.question);
				}}
			}
		},this)
		
		function setKey(flag, broker, binfo, cfg) {
	
			if (flag) {
				fetch_with_error(this.brokerURL(broker)+"/apikey")
				.then(function(ff){
					var w = formBuilder(ff);
					w.setData(cfg);
					this.dlgbox({text:w},"confirm").then(function() {
						if (!this.config.apikeys) this.config.apikeys = {};
						this.config.apikeys[broker] = w.readData();
						form.showItem("need_save",true);
						update.call(this);
					}.bind(this));
				}.bind(this));
			} else {
				if (!this.config.apikeys) this.config.apikeys = {};
				this.config.apikeys[broker] = null;
				form.showItem("need_save",true);
				update.call(this);
				
			}
			
		}
		
		var brokers = fetch_with_error(this.brokerURL("_all")).
			then(function(x) {
				return x.map(function(binfo) {
					var z = binfo.name;
					var cfg = this.config.apikeys && this.config.apikeys[z]
					var e = cfg === undefined?binfo.trading_enabled:cfg;
					return {
						img:this.brokerImgURL(z),
						broker: z,
						exchange:  {
								value:binfo.exchangeName,
								href:binfo.exchangeUrl
							},						
						state: {
								value: e?"✓":"∅",
								classList:{set:e, notset:!e}
							},
						bset: {
								".disabled": binfo.trading_enabled && cfg === undefined,
								"!click": setKey.bind(this, true, z, binfo, cfg)
							},
						
						berase: {
								".disabled":!binfo.trading_enabled && !cfg,
								"!click": setKey.bind(this, false, z, binfo, cfg)
							},
						info_button: {
								"!click": function() {
									this.dlgbox({text:fetch_with_error(this.brokerURL(z)+"/licence")
											.then(function(t) {
												return {"value":t,class:"textdoc"};
											}),
										cancel:{".hidden":true}},"confirm")
								}.bind(this)
							},						
					}
				}.bind(this));
			}.bind(this));
			
		
		var data = {
			rows:rows,
			brokers:brokers,
			add:{
				"!click":function() {
					
					this.addUser().then(function(u) {
						var itm = this.users.find(function(z) {
							return z.username == u.username;
						});
						if (itm) itm.password = u.password;
						else this.users.push(u);
						update.call(this);
					}.bind(this));					
				}.bind(this)
				
			},
			"logout":{"!click": this.logout.bind(this)},
			guest_role:{
				"!change":function() {
					this.config.guest = form.readData(["guest_role"]).guest_role == "viewer";
				}.bind(this),
				"value": !this.config.guest?"none":"viewer"
			},
			spinner: brokers.then(function() {
				return {".hidden":true}
			})
		};
		
		form.setData(data);
		
	}
	update.call(this);
	
	return form;
}

App.prototype.dlgbox = function(data, template) {
	return new Promise(function(ok, cancel) {
		var dlg = TemplateJS.View.fromTemplate(template);
		dlg.openModal();
		dlg.enableItem("ok",false);
		dlg.setData(data).then(function() {
			dlg.enableItem("ok",true);
		})
		dlg.setCancelAction(function() {
			dlg.close();cancel();
		},"cancel");
		dlg.setDefaultAction(function() {
			dlg.close();ok();
		},"ok");
	});		
}

App.prototype.save = function() {
	if (this.curForm) {
		this.curForm.save();
	}
	if (!this.config) {
		this.desktop.close();
		this.init();
		return;
	}
	var top = this.top_panel;
	top.showItem("saveprogress",true);
	top.showItem("saveok",false);
	this.config.users = this.users;
	this.config.traders = this.traders;
	this.validate(this.config).then(function(config) {		
		fetch_json("api/config",{
			method: "PUT",
			headers: {
				"Content-Type":"application/json",
			},
			body:JSON.stringify(config)
		}).then(function(x) {
			top.showItem("saveprogress",false);
			top.showItem("saveok",true);
			this.processConfig(x);
			this.updateTopMenu
			this.stopped = {};
		}.bind(this),function(e){			
			top.showItem("saveprogress",false);
			if (e.status == 409) {
				this.dlgbox({hdr:this.strtable.conflict1, 
							text:this.strtable.conflict2,
							ok:this.strtable.reload}, "confirm")
				.then(function() {
					location.reload();
				})
			} else {
				fetch_error(e);
			}
			
		}.bind(this));
	}.bind(this), function(e) {
		top.showItem("saveprogress",false);
		if (e.trader)   
			this.menu.select(e.trader);		
		this.dlgbox({text:e.message},"validation_error");
	}.bind(this));
}

App.prototype.logout = function() {
	this.desktop.setData({menu:"",content:""});
	this.config = null;
	fetch("api/logout").then(function(resp) {
		if (resp.status == 200) {
			location.reload();
		}
	});
}

App.prototype.validate = function(cfg) {
	return new Promise(function(ok, error) {
		var admin = cfg.users.find(function(x) {
			return x.admin;
		})
		if (!admin) return error({
				"trader":"!",
				"message":this.strtable.need_admin
			});	
		ok(cfg); 
	}.bind(this));
}



App.prototype.init_spreadvis = function(form, id) {
	var url = this.traderURL(id)+"/spread";
	form.enableItem("vis_spread",false);
	var el = form.findElements("spread_vis_anchor")[0];
	var bt = TemplateJS.View.fromTemplate("spread_vis");
	var spinner_cnt=0;
	el.parentNode.insertBefore(bt.getRoot(),el.nextSibling);

	function data_map(v, i) {
		return {time:i*60000, v:v};
	}
	
	var inputs = ["spread_calc_stdev_hours", "spread_calc_sma_hours","spread_mult","dynmult_raise","dynmult_fall","dynmult_mode"]; 

	function showSpinner() {
		spinner_cnt++;
		bt.showItem("spinner",true);
	}
	function hideSpinner() {
		if (--spinner_cnt == 0)
			bt.showItem("spinner",false);
	}
	
	function update() {
		showSpinner();
		var data = form.readData(inputs);
		var mult = Math.pow(2,data.spread_mult*0.01);
		var req = {
			sma:data.spread_calc_sma_hours,
			stdev:data.spread_calc_stdev_hours,
			mult:mult,
			raise:data.dynmult_raise,
			fall:data.dynmult_fall,
			mode:data.dynmult_mode,
		}
		
		
		fetch_with_error(url, {method:"POST", body:JSON.stringify(req)}).then(function(v) {			
			var c = v.chart.map(function(x) {
				x.achg = x.s;
				x.time = x.t;
				return x;
			})
			if (c.length == 0) return;

			var chart1 = bt.findElements('chart1')[0];
			var interval = c[c.length-1].time-c[0].time;
			var drawChart = initChart(interval,4,700000);

			drawChart(chart1,c,"p",[],"l", "h");
		}).then(hideSpinner,hideSpinner);
	};

	var tm;

	function delayUpdate() {
		if (tm) clearTimeout(tm);
		tm = setTimeout(function() {
			tm = null;
			update()},250);
	}

	inputs.forEach(function(a) {
		form.forEachElement(a, function(x){
			x.addEventListener("input",delayUpdate);
		})
	});
	update();

}

App.prototype.init_backtest = function(form, id, pair) {
	var url = this.traderURL(id)+"/trades";
	var el = form.findElements("backtest_anchor")[0];
	var bt = TemplateJS.View.fromTemplate("backtest_res");
	el.parentNode.insertBefore(bt.getRoot(),el.nextSibling);
	form.enableItem("init_backtest",false);		
	bt.getRoot().scrollIntoView(false);
	Promise.all([fetch_with_error(url),pair]).then(function(v) {
		var trades=v[0];
		var pair = v[1];
		if (trades.length == 0) {
			bt.close();
			this.dlgbox({text:this.strtable.backtest_nodata,cancel:{hidden:"hidden"}},"confirm");
			return;
		}
		if (trades.length < 100) {
			this.dlgbox({text:this.strtable.backtest_lesstrades,cancel:{hidden:"hidden"}},"confirm");
		}
		
		var lastTime = trades[trades.length-1].time;
		var firstTime = this.config.backtest_interval?(lastTime - this.config.backtest_interval):trades[0].time;
		
		var elems = ["external_assets","power", "max_pos",
			"sliding_pos_hours", "sliding_pos_fade",
			"order_mult","min_size","max_size","dust_orders","expected_trend","goal"];

		var chart1 = bt.findElements('chart1')[0];
		var chart2 = bt.findElements('chart2')[0];
		//var chart3 = bt.findElements('chart3')[0];
		var xdata = {
			"date_from":{
				"value":new Date(firstTime),
				"!change":recalc
			},
			"date_to":{
				"value":new Date(lastTime+86400000),
				"!change":recalc
			},
			"apply_from":{
				"value":new Date(firstTime),
				"!change":recalc
			},
			"start_pos":{
					"value":0,
					"!input":recalc
			}
		};
		bt.setData(xdata);
		var chart3 = bt.findElements('chart3')[0];
		
		var tm;
				
		var prevChart;
		
		function recalc() {
			if (tm) clearTimeout(tm);
			tm = setTimeout(function() {
				var data = form.readData(elems);
				var xdata = bt.readData();
			

				var min_size = parseFloat(data.min_size);
				if (pair.min_size > data.min_size) min_size = pair.min_size;
				if (data.dust_orders == false) min_size = 0;

				var h =  parseFloat(data.sliding_pos_hours);
				var w =  parseFloat(data.sliding_pos_fade);
				var g = data.goal;
				if (g == "norm") {
					w = 0;
					h = 0;
				}
				var et =  parseFloat(data.expected_trend)*0.01;
				if (pair.invert_price) {
					et = -et;
				}
				
				var trades2 = trades.filter(function(x) {
					var d = new Date(x.time);
					return d>=xdata.apply_from;
				});
				
				var btdata = {
						data:trades2,
						external_assets:parseFloat(data.external_assets),
						sliding_pos:h,
						fade:w,
						multiplicator:parseFloat(data.order_mult)*0.01,
						min_order_size:min_size,
						invert:false,
						expected_trend:et,
						start_pos:parseFloat(xdata.start_pos),
						max_order_size:parseFloat(data.max_size),
						step: pair.min_size,
						max_pos:parseFloat(data.max_pos)
						};
				
				var res = calculateBacktest(btdata);				

				if (pair.invert_price) {
					res.chart.forEach(function(x){
						x.price = 1/x.price;
						x.np = 1/x.np;
						x.achg = -x.achg;
					});
				}

				var chartData = res.chart.filter(function(x){
					var d = new Date(x.time);
					return d >=xdata.date_from && d<=xdata.date_to;
				});
				var interval = chartData.length?chartData[chartData.length-1].time - chartData[0].time:1;
				var drawChart = initChart(interval,5,700000);

			
				bt.setData({
					bt_pl: adjNum(res.pl),
					bt_pln: adjNum(res.pln),
					bt_dd: adjNum(res.mdd),
					bt_mp: adjNum(res.maxpos),
				})

				drawChart(chart1,chartData,"pl",[],"pln");
				drawChart(chart2,chartData,"price",[],"np");
				drawChart(chart3,chartData,"achg",[]);
			}.bind(this), 1);
		}
		
		recalc.call(this);
		elems.forEach(function(x) {
			var el = form.findElements(x)[0];
			el.addEventListener("input", recalc.bind(this));
		},this);		


		
	}.bind(this),function() {
			bt.close();
	});
}

App.prototype.optionsForm = function() {
	var form = TemplateJS.View.fromTemplate("options_form");
	var data = {
			report_interval: defval(this.config.report_interval,864000000)/86400000,
			backtest_interval: defval(this.config.backtest_interval,864000000)/86400000,
			stop:{"!click": function() {
					this.waitScreen(fetch_with_error("api/stop",{"method":"POST"}));
					for (var x in this.traders) this.stopped[x] = true;
			}.bind(this)},
			reload_brokers:{"!click":function() {
				this.waitScreen(fetch_with_error("api/brokers/_reload",{"method":"POST"}));
			}.bind(this)}
			
	};
	form.setData(data);
	form.save = function() {
		var data = form.readData();
		this.config.report_interval = data.report_interval*86400000;
		this.config.backtest_interval = data.backtest_interval*86400000;
	}.bind(this);
	return form;
	
}

App.prototype.tradingForm = function(id) {
	if (this.curForm && this.curForm.save) {
		this.curForm.save();
	}
	this.curForm = null;
	var _this = this;
	var cfg = this.traders[id];
	if (!cfg) return;
	
	
	var form = TemplateJS.View.fromTemplate("trading_form");
	this.desktop.setItemValue("content", form);
	
	function dialogRules() {
		var data = form.readData(["order_size","order_price","edit_order"]);				
		var p = !!data.order_price;
		var q = !!data.order_size;
		form.showItem("button_buy",p);
		form.showItem("button_sell",p);
		form.showItem("button_buybid",!p);
		form.showItem("button_sellask",!p);
		form.enableItem("button_buy",q);
		form.enableItem("button_sell",q);
		form.enableItem("button_buybid",q);
		form.enableItem("button_sellask",q);
	} 
	
	form.setItemEvent("order_price","input",dialogRules);
	form.setItemEvent("order_size","input",dialogRules);
	form.setItemEvent("edit_order","change",dialogRules);
	dialogRules();
		
	function update() {		
		var traderURL = _this.traderURL(id);
		var f = fetch_json(traderURL+"/trading").then(function(rs) {
				var pair = rs.pair;
				var chartData = rs.chart;
				var trades = rs.trades;
				var orders = rs.orders;
				var ticker = rs.ticker;
				var invp = function(x) {return pair.invert_price?1/x:x;}
				var invs = function(x) {return pair.invert_price?-x:x;}				
				var now = Date.now();
				var skip = true;
				chartData.push(ticker);
				trades.unshift({
					time: chartData[0].time-100000,
					price: chartData[0].last
				});
				
				var drawChart = initChart(chartData[chartData.length-1].time - chartData[0].time);
				var data = mergeArrays(chartData, trades, function(a,b) {
					return a.time - b.time
				},function(n, k, f, t) {
					var p1;
					var p2;
					var achg;
					if (n == 0) {
						if (f != null && t != null) {
							p2 = invp(interpolate(f.time, t.time, k.time, f.price, t.price));
							if (f.time == k.time) achg = invs(t.size);
						} else if (f != null) {
							p2 = invp(f.price);
						}
						p1 = invp(k.last);
						skip = false;
						
					} else {
						if (skip) return null;						
						p1 = p2 = invp(k.price);
						achg = invs(k.size);
					} 
					return {
						time: k.time,
						p1:p1,
						p2:p2,
						achg: achg
					}
				}).filter(function(x) {return x != null;});
				
				var lines = [];
				orders.forEach(function(x) {
					var sz = invs(x.size);
					var l = sz < 0?_this.strtable.sell:_this.strtable.buy
					lines.push({
						p1: invp(x.price),
						label: l+" "+Math.abs(sz)+" @",
						class: sz < 0?"sell":"buy"
					});
				});
				form.findElements("chart").forEach(function(elem) {
					drawChart(elem, data, "p1",lines,"p2" );
				})			
				var formdata = {};
				if (pair.invert_price) {
					formdata.ask_price = adjNumN(1/ticker.bid);
					formdata.bid_price = adjNumN(1/ticker.ask);					
				} else {
					formdata.ask_price = adjNumN(ticker.ask);
					formdata.bid_price = adjNumN(ticker.bid);										
				}
				formdata.bal_assets = adjNumN(invs(pair.asset_balance)) + " "+pair.asset_symbol;
				formdata.bal_currency = adjNumN(pair.currency_balance) + " "+pair.currency_symbol;
				formdata.last_price = adjNumN(invp(ticker.last));
				var orderMap  = orders.map(function(x) {
					return {"":{
						".value":JSON.stringify(x.id),
						"value":(invs(x.size)<0?_this.strtable.sell:_this.strtable.buy) 
								+ " " + adjNumN(Math.abs(x.size))
								+" @ " + adjNumN(invp(x.price))
					}}
				});
				formdata.orders = orders.map(function(x) {
					return {id:x.id,
						dir:invs(x.size)<0?_this.strtable.sell:_this.strtable.buy,
						size:adjNumN(Math.abs(x.size)),
						price:adjNumN(invp(x.price)),
						cancel:{
							"!click":function(ev) {
								ev.stopPropagation();
								this.hidden = true;
								this.nextSibling.hidden = false;
								_this.cancelOrder(cfg.id, cfg.pair_symbol, x.id).
									then(update);
							},
							".hidden":false
						
						},
						"spinner":{
							".hidden":true
						},
						"":{
							"!click":function() {
								form.setData({
									edit_orders: orderMap,
									edit_order: JSON.stringify(x.id),
									order_size: adjNumN(Math.abs(x.size)),
									order_price: adjNumN(invp(x.price)),
								});
								dialogRules();
							}
						}
					}
				});
				var cur_edit = form.readData(["edit_order"]);
				if (cur_edit.edit_order == "") {
					formdata.edit_orders=orderMap;
					formdata.edit_order = {
							"!change": function() {
								if (this.value=="") {
									form.setData({
										"order_size":"",
										"order_price":""
									});
								} else {								
									var itm = orders.find(function(x) {
										return this.value == JSON.stringify(x.id);
									}.bind(this));
									if (itm) form.setData({
										order_size: adjNumN(Math.abs(itm.size)),
										order_price: adjNumN(invp(itm.price))
									});
								}
								dialogRules();
							}
					}
				}
				
				form.setData(formdata);
				return rs;
			})
			
		return f;
	}
	function cycle_update() {
		if (!form.getRoot().isConnected) return;
		setTimeout(cycle_update, 15000);
		return update();
	}
	
	function clearForm() {
		form.setData({
			"order_size":"",
			"order_price":"",
			"edit_order":""
		});
		dialogRules();
	}
	
	
	cycle_update().then(function(f) {
		var pair = f.pair;

		function postOrder() {
			if (!_this.stopped[id] && cfg.enable) {
				_this.dlgbox({text:_this.strtable.trade_ask_stop},"confirm")
					.then(function() {
						return _this.waitScreen(fetch_with_error(_this.traderURL(cfg.id)+"/stop",{method:"POST"}));
					}).then(function() {
						_this.stopped[id] = true;
						postOrder.call(this);
					}.bind(this));
				return;
			}

			var b = this.dataset.name;
			var d = form.readData(["edit_order","order_price","order_size"]);

			var price = b == "button_buybid"?(pair.invert_price?"ask":"bid")
						:(b == "button_sellask"?(pair.invert_price?"bid":"ask"):
								(pair.invert_price?1/d.order_price:d.order_price));
			var size = ((b == "button_buybid" || b == "button_buy") == pair.invert_price?-1:1)*d.order_size;	
			var id;
			if (d.edit_order) id = JSON.parse(d.edit_order);
			var url = _this.traderPairURL(cfg.id, cfg.pair_symbol)+"/orders";
			var req = {
					size: size,
					price: price,
					replaceId: id,
					replaceSize: 0
			};
			clearForm();
			_this.waitScreen(fetch_with_error(url, {method:"POST", body: JSON.stringify(req)}).then(update));
		}

		form.setItemEvent("button_buy","click", postOrder);
		form.setItemEvent("button_sell", "click",postOrder);
		form.setItemEvent("button_buybid", "click",postOrder);
		form.setItemEvent("button_sellask", "click",postOrder);
	}).catch(fetch_error);
} 

App.prototype.cancelOrder = function(trader, pair, id) {
	var url = this.traderPairURL(trader, pair)+"/orders"
	var req = {
			size:0,
			price:0,
			replaceId: id,
			replaceSize: 0,			
	};
	return fetch_with_error(url,{method:"POST",body: JSON.stringify(req)});
}

App.prototype.brokerConfig = function(id, pair) {
	var burl = this.pairURL(id, pair)+"/settings";
	var form = fetch_with_error(burl).then(formBuilder);
	return this.dlgbox({form:form}, "broker_options_dlg").then(function() {
		form.then(function(f) {
			var d = f.readData();
			return fetch_with_error(burl, {method:"PUT",body:JSON.stringify(d)});				
		}.bind(this))
	}.bind(this))
}

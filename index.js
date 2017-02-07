var request = require('request');
var crypto = require('crypto');
var minimist = require('minimist');
var credentials = require('./credentials');
var apiKey = credentials.apiKey;
var apiSecret = credentials.apiSecret;
var autohedge = minimist(process.argv.slice(2), {boolean: 'autohedge'}).autohedge;

function call(verb, path, data, callback) {
  var expires = new Date().getTime() + (60 * 1000); // 1 min in the future

  // Pre-compute the postBody so we can be sure that we're using *exactly* the same body in the request
  // and in the signature. If you don't do this, you might get differently-sorted keys and blow the signature.
  var postBody = JSON.stringify(data);

  var signature = crypto.createHmac('sha256', apiSecret).update(verb + path + expires + postBody).digest('hex');

  var headers = {
    'content-type' : 'application/json',
    'Accept': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    // This example uses the 'expires' scheme. You can also use the 'nonce' scheme. See
    // https://www.bitmex.com/app/apiKeysUsage for more details.
    'api-expires': expires,
    'api-key': apiKey,
    'api-signature': signature
  };

  request({
      headers: headers,
      url: 'https://www.bitmex.com' + path,
      method: verb,
      body: postBody
    },
    function(error, response, body) {
      if (error) {
        console.log(error);
      } else {
        var result = JSON.parse(body);
        callback(result);
      }
    }
  );
}

function show(margin, position) {
  var marginBalanceXBT = margin.marginBalance / 1e8;
  var marginBalanceUSD = marginBalanceXBT * position.markPrice;

  var hedgedXBT = -position.homeNotional;
  var hedgedUSD =  position.foreignNotional;

  var unhedgedXBT = marginBalanceXBT - hedgedXBT;
  var unhedgedUSD = unhedgedXBT * position.markPrice;

  var profitXBT = (position.rebalancedPnl + position.realisedPnl) / 1e8;

  var hedgedPnlXBT = Math.max(0, Math.min(profitXBT - unhedgedXBT, profitXBT));
  var hedgedPnlUSD = hedgedPnlXBT * position.avgEntryPrice;

  var unhedgedPnlXBT = profitXBT - hedgedPnlXBT;
  var unhedgedPnlUSD = unhedgedPnlXBT * position.markPrice;

  var originalUSD  = hedgedUSD - hedgedPnlUSD;
  var profitUSD  = hedgedPnlUSD + unhedgedPnlUSD;
  var currentUSD   = originalUSD + profitUSD;
  var interestPcnt = profitUSD / originalUSD;

  console.log("Margin Balance: " + format(marginBalanceUSD)   + " USD");
  console.log("Hedged:         " + format(hedgedUSD)          + " USD");
  console.log("Unhedged:       " + format(unhedgedUSD)        + " USD");
  console.log("");
  console.log("Original Value: " + format(originalUSD)        + " USD");
  console.log("Current  Value: " + format(currentUSD)         + " USD");
  console.log("Profit:         " + format(profitUSD)          + " USD");
  console.log("Profit Pcnt:    " + format(interestPcnt * 100) + " %");
  console.log("");

  var side = unhedgedUSD > 0 ? "Sell" : "Buy";
  var orderQty = Math.floor(Math.abs(unhedgedUSD));
  console.log("Hedge order:    " + "  " + side + " "  + orderQty + " contracts");

  if (!orderQty) {
    console.log("No need to send hedge order.");
  } else if (!autohedge) {
    console.log("Use --autohedge to send hedge order.");
  } else {
    var order = {symbol: "XBTUSD", side: side, orderQty: orderQty, ordType: "Market", timeInForce: "ImmediateOrCancel"};
    call('POST', '/api/v1/order', order,
      function(result) {
        var slippagePcnt = position.commission + (side == 'Buy' ? 1 : -1) * (result.avgPx / position.markPrice - 1);
        console.log("Filled Quantity:" + format(result.cumQty)      + " USD");
        console.log("Filled Price:   " + format(result.avgPx)       + " USD");
        console.log("Slippage Pcnt:  " + format(slippagePcnt * 100) + " %");
      }
    );
  }
}

function format(number) {
  return ("         " + number.toFixed(2)).slice(-9);
}

// Start it off
call('GET', '/api/v1/user/margin', {filter: {currency: "XBt"}},
  function(result) {
    var margin = result;
    call('GET', '/api/v1/position', {filter: {symbol: "XBTUSD"}},
      function(result) {
        var position = result[0];
        show(margin, position);
      }
    );
  }
);

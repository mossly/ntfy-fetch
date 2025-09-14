const { NOAAProvider } = require("./dist/plugins/tide/NOAAProvider");
const { TimezoneHelper } = require("./dist/utils/timezone");

(async () => {
  console.log("🔍 Debugging tide data...");
  
  const noaaProvider = new NOAAProvider();
  const timezoneHelper = new TimezoneHelper();
  
  console.log("Current time:", new Date().toISOString());
  console.log("Cook Islands time:", timezoneHelper.formatLocalTime(new Date(), "yyyy-MM-dd HH:mm:ss zzz"));
  
  try {
    const tideData = await noaaProvider.fetchWithCache({ station: "TPT2853", days: 2 });
    console.log("\n📊 Fetched", tideData.predictions.length, "predictions");
    
    const now = new Date();
    const futureTides = tideData.predictions.filter(pred => pred.time > now);
    console.log("Future tides:", futureTides.length);
    
    if (futureTides.length > 0) {
      console.log("\n🔮 Next few tides:");
      futureTides.slice(0, 4).forEach(tide => {
        const localTime = timezoneHelper.formatLocalTime(tide.time, "MMM dd, h:mm a");
        console.log(`  ${tide.type === "H" ? "🌊 HIGH" : "🏖️ LOW"}: ${localTime} (${tide.height.toFixed(1)}m)`);
      });
      
      const nextHigh = await noaaProvider.getNextHighTide();
      const nextLow = await noaaProvider.getNextLowTide();
      
      console.log("\n🎯 Plugin methods:");
      console.log("getNextHighTide():", nextHigh ? timezoneHelper.formatLocalTime(nextHigh.time, "MMM dd, h:mm a") + " (" + nextHigh.height.toFixed(1) + "m)" : "null");
      console.log("getNextLowTide():", nextLow ? timezoneHelper.formatLocalTime(nextLow.time, "MMM dd, h:mm a") + " (" + nextLow.height.toFixed(1) + "m)" : "null");
    } else {
      console.log("❌ No future tides found!");
    }
  } catch (error) {
    console.error("❌ Error:", error.message);
  }
})();

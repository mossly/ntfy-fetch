// Test script for event scheduler
const { NtfyFetchService } = require('./dist/index');

async function testEventScheduler() {
  console.log('🧪 Testing Event Scheduler System\n');

  // Enable event scheduler
  process.env.USE_EVENT_SCHEDULER = 'true';

  const service = new NtfyFetchService(true);

  try {
    console.log('Starting service with event scheduler...');
    await service.start();

    console.log('\n✅ Service started successfully\n');

    // Get status
    const status = await service.getStatus();
    console.log('Service Status:');
    console.log(JSON.stringify(status, null, 2));

    // Wait a bit to see if events are scheduled
    console.log('\n⏳ Waiting 10 seconds for events to be scheduled...\n');
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Get updated status
    const updatedStatus = await service.getStatus();
    console.log('\nUpdated Service Status:');
    console.log(JSON.stringify(updatedStatus.eventScheduler, null, 2));

    // Check scheduled events file
    const fs = require('fs');
    const eventsPath = './data/scheduled-events.json';

    if (fs.existsSync(eventsPath)) {
      const events = JSON.parse(fs.readFileSync(eventsPath, 'utf-8'));
      console.log(`\n📅 Found ${events.length} scheduled events in persistence file`);

      if (events.length > 0) {
        console.log('\nUpcoming events (first 5):');
        events.slice(0, 5).forEach(event => {
          const scheduledTime = new Date(event.scheduledFor);
          const now = new Date();
          const minutesUntil = Math.floor((scheduledTime - now) / 60000);

          console.log(`  - ${event.payload.title}`);
          console.log(`    Scheduled for: ${scheduledTime.toLocaleString()}`);
          console.log(`    Time until: ${minutesUntil} minutes`);
          console.log(`    Status: ${event.status}`);
        });
      }
    }

    console.log('\n🛑 Stopping service...');
    await service.stop();

    console.log('\n✅ Test completed successfully!');

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    await service.stop();
    process.exit(1);
  }
}

// Run the test
testEventScheduler().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('Test error:', error);
  process.exit(1);
});
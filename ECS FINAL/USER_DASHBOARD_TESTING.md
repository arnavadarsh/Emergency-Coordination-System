# User Dashboard - Features & Testing Guide

## ✅ Fixed Issues

### 1. **Booking Creation**
- ✅ Added proper validation for pickup location
- ✅ Added better error handling with detailed error messages  
- ✅ Added console logging for debugging
- ✅ Fixed field mapping (pickupAddress, destinationAddress properly set)
- ✅ Added severity and description for emergency bookings

### 2. **Missing CSS Styles**
- ✅ Added Tailwind-like utility classes to Dashboard.css
- ✅ Added styles for SavedLocationsTab component
- ✅ Added styles for NotificationPreferencesSection component
- ✅ All animations, spacing, colors, and layouts now properly styled

## 📋 How to Test

### Testing Booking Creation:

1. **Emergency Booking:**
   - Click "🚨 Request Emergency Ambulance"
   - Click "Use Current Location" or search for a pickup location
   - Fill in the triage form:
     - Chief complaint (e.g., "Chest pain")
     - Select severity level
     - Check relevant symptoms
   - Click "Request Emergency Ambulance"
   - Check browser console (F12) for any errors
   - Should see success message

2. **Scheduled Booking:**
   - Click "📅 Schedule Transport"
   - Select pickup location
   - Select dropoff location (destination)
   - Pick date/time
   - Select required facilities  
   - Click "Schedule Transport"

### Testing Saved Locations:

1. Go to Dashboard → Click "Saved Locations" tab
2. Click "Add New Location" button
3. Fill in:
   - Label (e.g., "Home", "Work", "Hospital")
   - Address
   - Latitude/Longitude
4. Click Save
5. Test Edit, Delete, and Set as Default features

### Testing Notification Preferences:

1. Go to Dashboard → Profile tab
2. Scroll to "🔔 Notification Preferences" section
3. Toggle Email, SMS, and Push notifications
4. Click "Save Preferences"
5. Should see "✓ Saved" confirmation

## 🐛 Troubleshooting

### If booking still doesn't create:

1. **Check browser console** (F12 → Console tab)
   - Look for red errors
   - Check the console.log messages showing booking data

2. **Check Network tab** (F12 → Network tab)
   - Click on the POST request to `/api/bookings`
   - Check the "Payload" tab to see what data was sent
   - Check the "Response" tab to see error details

3. **Common issues:**
   - **401 Unauthorized**: Token expired, need to re-login
   - **400 Bad Request**: Missing required fields (check console logs)
   - **500 Server Error**: Backend issue (check backend terminal)

### If styles are missing:

1. **Hard refresh** the page: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)
2. **Clear browser cache** and reload
3. **Check** that Dashboard.css is being loaded (F12 → Sources tab)

## 📊 Backend Logs

Watch the backend terminal for:
- `query: INSERT INTO "bookings"` - Confirms booking is being created
- `Dispatched ambulance` - Confirms auto-dispatch is working
- Any error stack traces

## 🎯 Expected Behavior

### After creating a booking:
1. Success alert appears
2. Booking form closes
3. New booking appears in "My Bookings" list
4. Booking shows status: "CREATED" → "ASSIGNED" (within seconds)
5. Dispatch info shows ambulance details

## 💡 Tips

- **Use Current Location** button requires HTTPS or localhost
- **Maps** should be draggable - drag markers to adjust location
- **Autocomplete** suggestions appear after typing 3+ characters
- **Emergency SOS** button sends CRITICAL priority booking with current location

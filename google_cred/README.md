# Google Sheets Credentials Setup

## Step 1: Get Google Service Account Credentials

1. **Go to Google Cloud Console**: https://console.cloud.google.com/

2. **Create or Select a Project**:
   - Click on the project dropdown at the top
   - Create a new project or select an existing one

3. **Enable Google Sheets API**:
   - Go to "APIs & Services" > "Library"
   - Search for "Google Sheets API"
   - Click "Enable"

4. **Create Service Account**:
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "Service Account"
   - Fill in the service account details
   - Click "Create and Continue"
   - Grant the service account the "Editor" role (or custom role with sheets permissions)
   - Click "Done"

5. **Generate Service Account Key**:
   - Click on the service account you just created
   - Go to the "Keys" tab
   - Click "Add Key" > "Create new key"
   - Select "JSON" format
   - Click "Create"
   - The JSON file will be downloaded to your computer

6. **Place the Credentials File**:
   - Rename the downloaded file to `credentials.json`
   - Move it to this directory (`google_cred/`)
   - Your final path should be: `./google_cred/credentials.json`

## Step 2: Share Your Google Sheet with the Service Account

1. **Open your credentials.json file** and find the `client_email` field
   - It will look like: `your-service-account@your-project.iam.gserviceaccount.com`

2. **Open your Google Sheet** that you want to use for the CRM

3. **Click "Share"** in the top-right corner

4. **Add the service account email**:
   - Paste the `client_email` from step 1
   - Give it "Editor" permissions
   - Uncheck "Notify people"
   - Click "Share"

5. **Get your Spreadsheet ID**:
   - Look at your Google Sheet URL
   - It will be: `https://docs.google.com/spreadsheets/d/YOUR_SPREADSHEET_ID/edit`
   - Copy the `YOUR_SPREADSHEET_ID` part
   - Update the `.env` file with this ID in the `GOOGLE_SHEETS_SPREADSHEET_ID` field

## Step 3: Update Environment Variables

Edit the `.env` file in the root directory:

```bash
# Update these values:
GOOGLE_SHEETS_CREDENTIALS_PATH=./google_cred/credentials.json
GOOGLE_SHEETS_SPREADSHEET_ID=your_actual_spreadsheet_id_here
```

## Step 4: Verify Setup

Run the following command to test your setup:

```bash
npm run build
npm start:api
```

Then test the API:

```bash
# Initialize the sheet (creates headers)
curl -X POST http://localhost:3000/api/servers/sheets/tools/initialize_sheet

# List all tools
curl http://localhost:3000/api/tools
```

## Security Notes

⚠️ **IMPORTANT**: Never commit your `credentials.json` file to version control!

- The `.gitignore` file is already configured to exclude `*.json` files in this directory
- The `.env` file is also excluded from version control
- Keep these files secure and never share them publicly

## Troubleshooting

### Error: "Unable to read credentials"
- Check that `credentials.json` exists in the `google_cred/` directory
- Verify the path in `.env` is correct: `./google_cred/credentials.json`

### Error: "Permission denied" when accessing sheets
- Make sure you shared the spreadsheet with the service account email
- Verify the service account has "Editor" permissions

### Error: "Invalid spreadsheet ID"
- Check that you copied the correct ID from the Google Sheets URL
- Make sure there are no extra spaces in the `.env` file

## File Structure

```
crm_mcp_server/
├── google_cred/
│   ├── credentials.json       # Your Google Service Account key (DO NOT COMMIT)
│   └── README.md              # This file
├── .env                       # Environment configuration (DO NOT COMMIT)
├── .env.example               # Example configuration (safe to commit)
└── ...
```

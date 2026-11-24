# Pinboard Pinterest Analytics

A responsive dashboard for Pinterest account metrics, daily performance, top Pins, and Gemini-generated growth suggestions. Pinterest data is retrieved by the local MCP server and exposed to the frontend by the Express backend.

## Run locally

1. In a PowerShell terminal, create the private local env file and open it for editing:

   ```powershell
   cd "C:\Users\91911\Desktop\Pintrest dashboard\Backend"
   Copy-Item .env.example .env
   notepad .env
   ```

   Replace the example values with your Pinterest API access token and Gemini API key, then save the file. **Do not paste API keys into chat or put them in frontend code.** `Backend/.env` is ignored by Git.
2. Start the backend from the `Backend` directory:

   ```sh
   npm start
   ```

3. In a separate terminal, start the frontend from the `Frontend` directory:

   ```sh
   npm run dev
   ```

4. Open the local URL printed by Vite.

The frontend proxies `/api` requests to `http://localhost:4000`. Restart the backend after changing `Backend/.env`. Without live credentials, the dashboard shows a connection/setup message rather than inventing account metrics. A Pinterest CSV export can provide daily account trends as a fallback, but follower totals and Pin-level metrics require the live Pinterest connection. Pinterest may also require the API app/trial to be approved and the token to have account and analytics permissions.

## Dashboard features

- Followers, following, monthly views, Pins, and boards when returned by Pinterest.
- Impressions, saves, Pin clicks, and outbound clicks with 7-day, 30-day, and all-time chart ranges.
- Automatic comparison of the latest seven tracked days against the preceding seven days.
- Recent Pin performance, Gemini recommendations, and a personalized seven-day content strategy.
- A conversational analytics assistant for questions about performance changes and content.

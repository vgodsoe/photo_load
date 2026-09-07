# Azure setup for first-time users

Azure uses several similarly named resources. For this project:

- **Subscription**: the billing container. The expected wedding usage should fit the free allowances.
- **Microsoft Entra app registration**: gives the uploader permission to your personal OneDrive.
- **Function App**: runs the private upload code.

Complete one section at a time. Do not put a client ID or refresh token in GitHub.

## 1. Get into the correct directory

1. Open [Azure portal](https://portal.azure.com) in a private browser window and sign in with the personal Microsoft account that owns the OneDrive.
2. If Azure asks you to create an account or subscription, complete that first. A paid OneDrive plan is separate from Azure.
3. Select your profile at the top right, then **Switch directory**.
4. Select your **Default Directory**. Do not select **Microsoft Services**.

If there is no Default Directory, create the Azure account at [azure.microsoft.com/free](https://azure.microsoft.com/free/) and return to this section.

## 2. Register the OneDrive application

1. In the Azure portal search box, enter **Microsoft Entra ID** and open it.
2. Select **App registrations** in the left menu, then **New registration**.
3. Name it `Wedding Photo Upload`.
4. For **Supported account types**, select **Personal Microsoft accounts only**. If that choice is unavailable, select **Accounts in any organizational directory and personal Microsoft accounts**.
5. Leave **Redirect URI** empty and select **Register**.
6. On the app overview, copy the **Application (client) ID**. This is not a secret.
7. Select **Authentication** in the left menu.
8. Under **Advanced settings**, set **Allow public client flows** to **Yes**, then select **Save**.
9. Select **API permissions**, then **Add a permission** > **Microsoft Graph** > **Delegated permissions**.
10. Search for and select `Files.ReadWrite`, then select **Add permissions**. `offline_access` is requested automatically during login and might not appear in this list.

Do not create a client secret. The local helper uses Microsoft's device-code flow for personal accounts.

## 3. Authorize your OneDrive once

In the VS Code terminal, from the repository root, run:

```powershell
npm run authorize --prefix api
```

Paste the Application (client) ID when prompted. The helper displays a Microsoft URL and short code. Open that URL, enter the code, sign in with the personal account that owns the OneDrive, and approve access.

The helper creates `Wedding Uploads` in OneDrive and saves the credentials in `api/local.settings.json`. That file is ignored by Git. Treat it like a password.

## 4. Create the Function App

1. In the Azure portal, select **Create a resource** and search for **Function App**.
2. Select **Create**, choose **Flex Consumption**, then **Select**. A paid subscription is required, but normal wedding usage should remain inside the monthly on-demand grant.
3. On **Basics**, use:

   | Setting | Value |
   | --- | --- |
   | Subscription | Your Azure subscription |
   | Resource group | Create `wedding-photo-upload` |
   | Function App name | A globally unique name such as `wedding-upload-yourinitials` |
   | Region | The nearest available region |
   | Runtime stack | Node.js |
   | Version | 22 LTS, or the newest supported LTS |
   | Instance size | Default |

4. Accept the defaults on **Storage** and **Networking**.
5. On **Monitoring**, Application Insights can be disabled to minimize extra resources, or left enabled for easier troubleshooting.
6. On **Authentication**, use the default managed identity option for Azure's own resources.
7. Select **Review + create**, then **Create**. Wait for **Deployment succeeded** and open the resource.

This managed identity setting is unrelated to the personal OneDrive login and does not replace the refresh token.

## 5. Configure direct upload storage

The Function App creates a storage account automatically. Open the storage account shown on the Function App overview, then:

1. Open **Settings** > **Resource sharing (CORS)**.
2. On the **Blob service** row add:
   - Allowed origins: `https://vgodsoe.github.io`
   - Allowed methods: `PUT`, `OPTIONS`
   - Allowed headers: `*`
   - Exposed headers: `*`
   - Max age: `3600`
3. Save the CORS settings.

Add a lifecycle rule under **Data management** > **Lifecycle management** that deletes block blobs in the `incoming` container after 14 days. This bounds storage cost while leaving ample time to recover any OneDrive copy that repeatedly fails.

The API creates the private `incoming` container and `onedrive-uploads` queue on its first request. Uploaded files remain in Blob storage until the queue worker successfully copies them to OneDrive.

## 6. Add the private settings

Generate the QR event token locally:

```powershell
npm run create-event-token --prefix api
```

1. In the Function App, open **Settings** > **Environment variables**.
2. Open `api/local.settings.json` locally. Do not post or share its contents.
3. Add these application settings using the matching local values:

   | Name | Value |
   | --- | --- |
   | `MICROSOFT_CLIENT_ID` | The local setting with this name |
   | `MICROSOFT_REFRESH_TOKEN` | The long local setting with this name |
   | `ONEDRIVE_FOLDER_PATH` | `Wedding Uploads` |
   | `ALLOWED_ORIGIN` | `https://vgodsoe.github.io` |
   | `EVENT_TOKEN` | The local setting with this name |

4. Select **Apply** and confirm the Function App restart.

For a GitHub project page, the browser origin does not include the repository path. For `https://username.github.io/photo_load/`, use `https://username.github.io`.

Also open **API** > **CORS** in the Function App and add `https://vgodsoe.github.io` as an allowed origin.

## 7. Deploy and connect it

The easiest first deployment is through the Azure Functions extension for VS Code:

1. Install the **Azure Functions** extension from Microsoft.
2. Sign in to Azure from its sidebar.
3. Open the `api` folder in a separate VS Code window.
4. In the Azure sidebar, under **Workspace**, select **Deploy to Function App**.
5. Choose the Function App created above and confirm deployment.
6. Copy the Function App's **Default domain** from its overview page.
7. Replace `API_BASE_URL` at the top of `app.js` with `https://` followed by that domain, commit, and push to `main`.
8. Your QR URL is `https://vgodsoe.github.io/photo_load/?event=YOUR_EVENT_TOKEN`, using the token from the private local settings file.

After GitHub Pages finishes deploying, test with one small photo before printing the QR code.

## Troubleshooting

- **AADSTS16000 / Microsoft Services**: sign out, use a private window, and switch to **Default Directory** before opening Entra ID.
- **Public client flows disabled**: return to the app registration's **Authentication** page and enable **Allow public client flows**.
- **Upload service has not been connected**: `UPLOAD_ENDPOINT` still contains `YOUR-FUNCTION`.
- **Browser CORS error**: `ALLOWED_ORIGIN` does not exactly match the origin shown in the browser address bar.
- **OneDrive authorization expires**: rerun `npm run authorize --prefix api`, then replace `MICROSOFT_REFRESH_TOKEN` in the Function App settings.
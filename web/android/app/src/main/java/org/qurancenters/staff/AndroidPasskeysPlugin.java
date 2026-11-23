package org.qurancenters.staff;

import android.app.Activity;
import android.os.Build;
import androidx.core.content.ContextCompat;
import androidx.credentials.CreateCredentialResponse;
import androidx.credentials.CreatePublicKeyCredentialRequest;
import androidx.credentials.CreatePublicKeyCredentialResponse;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.GetPublicKeyCredentialOption;
import androidx.credentials.PublicKeyCredential;
import androidx.credentials.exceptions.CreateCredentialException;
import androidx.credentials.exceptions.GetCredentialException;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONException;

@CapacitorPlugin(name = "AndroidPasskeys")
public class AndroidPasskeysPlugin extends Plugin {
    @PluginMethod
    public void register(PluginCall call) {
        JSObject options = requestOptions(call);
        if (options == null) return;

        Activity activity = getActivity();
        activity.runOnUiThread(() -> {
            try {
                var request = new CreatePublicKeyCredentialRequest(options.toString());
                CredentialManager.create(activity).createCredentialAsync(
                    activity, request, null, ContextCompat.getMainExecutor(activity),
                    new CredentialManagerCallback<CreateCredentialResponse, CreateCredentialException>() {
                        @Override
                        public void onResult(CreateCredentialResponse result) {
                            if (result instanceof CreatePublicKeyCredentialResponse passkey) {
                                resolveResponse(call, passkey.getRegistrationResponseJson());
                            } else {
                                call.reject("Unexpected credential type", "INVALID_RESPONSE");
                            }
                        }

                        @Override
                        public void onError(CreateCredentialException error) {
                            rejectCredentialError(call, error);
                        }
                    }
                );
            } catch (IllegalArgumentException error) {
                call.reject("Invalid passkey registration options", "INVALID_OPTIONS");
            }
        });
    }

    @PluginMethod
    public void verify(PluginCall call) {
        JSObject options = requestOptions(call);
        if (options == null) return;

        Activity activity = getActivity();
        activity.runOnUiThread(() -> {
            try {
                var request = new GetCredentialRequest.Builder()
                    .addCredentialOption(new GetPublicKeyCredentialOption(options.toString()))
                    .setPreferImmediatelyAvailableCredentials(true)
                    .build();
                CredentialManager.create(activity).getCredentialAsync(
                    activity, request, null, ContextCompat.getMainExecutor(activity),
                    new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                        @Override
                        public void onResult(GetCredentialResponse result) {
                            if (result.getCredential() instanceof PublicKeyCredential passkey) {
                                resolveResponse(call, passkey.getAuthenticationResponseJson());
                            } else {
                                call.reject("Unexpected credential type", "INVALID_RESPONSE");
                            }
                        }

                        @Override
                        public void onError(GetCredentialException error) {
                            rejectCredentialError(call, error);
                        }
                    }
                );
            } catch (IllegalArgumentException error) {
                call.reject("Invalid passkey verification options", "INVALID_OPTIONS");
            }
        });
    }

    private JSObject requestOptions(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
            call.reject("Passkeys require Android 9 or newer", "UNSUPPORTED_ANDROID");
            return null;
        }

        JSObject options = call.getObject("options");
        if (options == null) call.reject("Missing passkey options", "INVALID_OPTIONS");
        return options;
    }

    private void resolveResponse(PluginCall call, String response) {
        try {
            call.resolve(new JSObject(response));
        } catch (JSONException error) {
            call.reject("Invalid passkey response", "INVALID_RESPONSE");
        }
    }

    private void rejectCredentialError(PluginCall call, Exception error) {
        call.reject("Android credential request failed", error.getClass().getSimpleName());
    }
}

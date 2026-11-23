package org.qurancenters.staff;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.os.Build;
import android.os.CancellationSignal;
import android.provider.Settings;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import androidx.annotation.RequiresApi;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.security.GeneralSecurityException;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.ProviderException;
import java.security.Signature;
import java.security.spec.ECGenParameterSpec;
import java.util.UUID;
import org.json.JSONException;

@CapacitorPlugin(name = "AndroidBiometrics")
public class AndroidBiometricsPlugin extends Plugin {
    private static final String STORE = "AndroidKeyStore";
    private static final String ALIAS_PREFIX = "centers-attendance-";

    @PluginMethod
    public void enroll(PluginCall call) {
        if (!available(call)) return;
        try {
            String alias = alias(call.getString("id"));
            byte[] challenge = challenge(call);
            KeyStore store = keyStore();
            if (store.containsAlias(alias)) {
                call.reject("Enrollment already started", "RETRY_ENROLLMENT");
                return;
            }
            enrollKey(call, store, alias, challenge);
        } catch (GeneralSecurityException | IOException | ProviderException | IllegalArgumentException error) {
            call.reject("Could not create the protected key", "KEY_UNAVAILABLE");
        }
    }

    @RequiresApi(30)
    private void enrollKey(PluginCall call, KeyStore store, String alias, byte[] challenge)
        throws GeneralSecurityException {
        KeyPairGenerator generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, STORE);
        generator.initialize(new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN)
            .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)
            .setUserAuthenticationRequired(true)
            .setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
            .setInvalidatedByBiometricEnrollment(true)
            .setAttestationChallenge(challenge)
            .build());
        generator.generateKeyPair();
        try {
            var certificates = store.getCertificateChain(alias);
            if (certificates == null || certificates.length < 2)
                throw new GeneralSecurityException("Missing hardware attestation");
            var chain = new JSArray();
            for (var cert : certificates) chain.put(encode(cert.getEncoded()));
            prompt(call, signingOperation((PrivateKey) store.getKey(alias, null)), challenge,
                new JSObject().put("chain", chain), () -> discardKey(store, alias));
        } catch (GeneralSecurityException | ProviderException error) {
            discardKey(store, alias);
            throw error;
        }
    }

    @PluginMethod
    public void sign(PluginCall call) {
        if (!available(call)) return;
        try {
            byte[] challenge = challenge(call);
            KeyStore store = keyStore();
            var ids = call.getArray("keyIds");
            if (ids == null || ids.length() > 10) throw new IllegalArgumentException();
            for (int i = 0; i < ids.length(); i++) {
                String id = ids.getString(i);
                String alias = alias(id);
                if (store.getKey(alias, null) instanceof PrivateKey key) {
                    try {
                        prompt(call, signingOperation(key), challenge, new JSObject().put("keyId", id), () -> {});
                        return;
                    } catch (KeyPermanentlyInvalidatedException error) {
                        discardKey(store, alias);
                    }
                }
            }
            call.reject("No registered key on this phone", "DEVICE_NOT_REGISTERED");
        } catch (GeneralSecurityException | IOException | JSONException | ProviderException | IllegalArgumentException error) {
            call.reject("Could not open the biometric key", "KEY_UNAVAILABLE");
        }
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            call.reject("Android 11 is required", "UNSUPPORTED_ANDROID");
            return;
        }
        Activity activity = getActivity();
        activity.runOnUiThread(() -> {
            var intent = new Intent(Settings.ACTION_BIOMETRIC_ENROLL)
                .putExtra(Settings.EXTRA_BIOMETRIC_AUTHENTICATORS_ALLOWED,
                    BiometricManager.Authenticators.BIOMETRIC_STRONG);
            try {
                activity.startActivity(intent);
                call.resolve();
            } catch (android.content.ActivityNotFoundException error) {
                call.reject("Open the phone security settings", "SETTINGS_UNAVAILABLE");
            }
        });
    }

    @PluginMethod
    public void remove(PluginCall call) {
        try {
            keyStore().deleteEntry(alias(call.getString("keyId")));
            call.resolve();
        } catch (GeneralSecurityException | IOException | IllegalArgumentException error) {
            call.reject("Could not remove the local key", "KEY_UNAVAILABLE");
        }
    }

    private boolean available(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            call.reject("Android 11 is required", "UNSUPPORTED_ANDROID");
            return false;
        }
        if (!getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_FINGERPRINT)) {
            call.reject("Fingerprint sensor unavailable", "NO_FINGERPRINT");
            return false;
        }
        var biometrics = getContext().getSystemService(BiometricManager.class);
        int status = biometrics.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG);
        if (status == BiometricManager.BIOMETRIC_SUCCESS) return true;
        call.reject("Biometric authentication unavailable", status == BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED
            ? "NOT_ENROLLED" : "SENSOR_UNAVAILABLE");
        return false;
    }

    private void prompt(PluginCall call, Signature signature, byte[] challenge, JSObject result, Runnable onFailure) {
        Activity activity = getActivity();
        activity.runOnUiThread(() -> {
            var executor = activity.getMainExecutor();
            try {
                var prompt = new BiometricPrompt.Builder(activity)
                    .setTitle("إثبات الحضور بالبصمة")
                    .setSubtitle("تحقّق باستخدام بصمة الجهاز")
                    .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                    .setNegativeButton("إلغاء", executor, (dialog, button) -> {
                        onFailure.run();
                        call.reject("Biometric prompt canceled", "PROMPT_13");
                    })
                    .build();
                prompt.authenticate(new BiometricPrompt.CryptoObject(signature), new CancellationSignal(), executor,
                    new BiometricPrompt.AuthenticationCallback() {
                        @Override
                        public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult authentication) {
                            try {
                                Signature unlocked = authentication.getCryptoObject().getSignature();
                                unlocked.update(challenge);
                                call.resolve(result.put("signature", encode(unlocked.sign())));
                            } catch (GeneralSecurityException error) {
                                onFailure.run();
                                call.reject("Could not sign the attendance challenge", "KEY_UNAVAILABLE");
                            }
                        }

                        @Override
                        public void onAuthenticationError(int code, CharSequence detail) {
                            onFailure.run();
                            call.reject("Biometric prompt ended", "PROMPT_" + code);
                        }
                    });
            } catch (IllegalStateException | IllegalArgumentException error) {
                onFailure.run();
                call.reject("Could not show the biometric prompt", "SENSOR_UNAVAILABLE");
            }
        });
    }

    private static KeyStore keyStore() throws GeneralSecurityException, IOException {
        KeyStore store = KeyStore.getInstance(STORE);
        store.load(null);
        return store;
    }

    private static Signature signingOperation(PrivateKey key) throws GeneralSecurityException {
        Signature signature = Signature.getInstance("SHA256withECDSA");
        signature.initSign(key);
        return signature;
    }

    private static byte[] challenge(PluginCall call) {
        String encoded = call.getString("challenge");
        if (encoded == null || encoded.length() != 44) throw new IllegalArgumentException();
        byte[] value = Base64.decode(encoded, Base64.DEFAULT);
        if (value.length != 32) throw new IllegalArgumentException();
        return value;
    }

    private static String alias(String id) {
        if (id == null || id.length() != 36) throw new IllegalArgumentException();
        return ALIAS_PREFIX + UUID.fromString(id);
    }

    private static String encode(byte[] value) {
        return Base64.encodeToString(value, Base64.NO_WRAP);
    }

    private static void discardKey(KeyStore store, String alias) {
        try {
            store.deleteEntry(alias);
        } catch (GeneralSecurityException error) {
            android.util.Log.w("AndroidBiometrics", "Could not discard the local attendance key.", error);
        }
    }
}

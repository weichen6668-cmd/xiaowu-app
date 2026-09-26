package com.xiaowu.mage;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;

import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * KeystorePlugin：apiKey 存取唯一原生入口（AES-GCM via AndroidKeyStore + EncryptedSharedPreferences）。
 * 对外签名对齐 shared/src/types.ts SecureStore：set/get/remove。
 * 禁止 apiKey 出沙盒明文（加密落盘，JS 侧只见明文瞬间传参）。
 */
@CapacitorPlugin(name = "KeystorePlugin")
public class KeystorePlugin extends Plugin {

    private SharedPreferences prefs() throws Exception {
        Context context = getContext();
        KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(
                MasterKey.DEFAULT_MASTER_KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build();
        MasterKey masterKey = new MasterKey.Builder(context)
                .setKeyGenParameterSpec(spec)
                .build();
        return EncryptedSharedPreferences.create(
                context,
                "xw_secure_store",
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM);
    }

    @PluginMethod
    public void set(PluginCall call) {
        try {
            String key = call.getString("key", "");
            String value = call.getString("value", "");
            prefs().edit().putString(key, value).apply();
            call.resolve();
        } catch (Exception e) {
            call.reject("keystore set failed: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void get(PluginCall call) {
        try {
            String key = call.getString("key", "");
            String value = prefs().getString(key, null);
            JSObject ret = new JSObject();
            ret.put("value", value);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("keystore get failed: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        try {
            String key = call.getString("key", "");
            prefs().edit().remove(key).apply();
            call.resolve();
        } catch (Exception e) {
            call.reject("keystore remove failed: " + e.getMessage(), e);
        }
    }
}

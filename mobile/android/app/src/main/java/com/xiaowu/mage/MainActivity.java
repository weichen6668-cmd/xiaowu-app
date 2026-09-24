package com.xiaowu.mage;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 注册 Keystore 原生插件（须在 super.onCreate 之前，桥初始化时才可见）
        registerPlugin(KeystorePlugin.class);
        super.onCreate(savedInstanceState);
    }
}

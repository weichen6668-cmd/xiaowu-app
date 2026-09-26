package com.xiaowu.mage;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.xiaowu.mage.overlay.OverlayPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 注册 Keystore 原生插件（须在 super.onCreate 之前，桥初始化时才可见）
        registerPlugin(KeystorePlugin.class);
        // T06：悬浮窗插件注册（同模式）
        registerPlugin(OverlayPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

package com.cybermates.app;

import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(EmulatorCheckPlugin.class);
        super.onCreate(savedInstanceState);
        // Autoplay the app's WebAudio music without a tap (native app only; web browsers still need a gesture).
        WebView wv = getBridge() != null ? getBridge().getWebView() : null;
        if (wv != null) wv.getSettings().setMediaPlaybackRequiresUserGesture(false);
    }
}

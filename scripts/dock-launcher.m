#import <Cocoa/Cocoa.h>

static NSString *const kConfigRootDirKey = @"rootDir";

@interface AppDelegate : NSObject <NSApplicationDelegate>
@property (nonatomic, copy) NSString *rootDir;
@property (nonatomic, assign) BOOL readyForReopen;
@property (nonatomic, assign) NSTimeInterval lastActivationTime;
@property (nonatomic, assign) NSTimeInterval lastOpenTerminalTime;
@end

@implementation AppDelegate

- (NSString *)scriptsDir {
  return [self.rootDir stringByAppendingPathComponent:@"scripts"];
}

- (BOOL)loadConfig {
  NSURL *configURL = [[NSBundle mainBundle] URLForResource:@"config" withExtension:@"plist"];
  if (configURL == nil) {
    return NO;
  }

  NSDictionary *plist = [NSDictionary dictionaryWithContentsOfURL:configURL];
  NSString *rootDir = plist[kConfigRootDirKey];
  if (rootDir.length == 0) {
    return NO;
  }

  BOOL isDirectory = NO;
  if (![[NSFileManager defaultManager] fileExistsAtPath:rootDir isDirectory:&isDirectory] || !isDirectory) {
    return NO;
  }

  self.rootDir = rootDir;
  return YES;
}

- (void)showAlert:(NSString *)message {
  NSAlert *alert = [[NSAlert alloc] init];
  alert.messageText = @"AI Companion Dev";
  alert.informativeText = message;
  alert.alertStyle = NSAlertStyleCritical;
  [alert runModal];
}

- (int32_t)runScriptNamed:(NSString *)name {
  NSString *script = [[self scriptsDir] stringByAppendingPathComponent:name];
  if (![[NSFileManager defaultManager] isExecutableFileAtPath:script]) {
    return 1;
  }

  NSTask *task = [[NSTask alloc] init];
  task.executableURL = [NSURL fileURLWithPath:script];
  task.currentDirectoryURL = [NSURL fileURLWithPath:self.rootDir];

  @try {
    [task launch];
    [task waitUntilExit];
    return task.terminationStatus;
  } @catch (NSException *exception) {
    return 1;
  }
}

- (BOOL)shouldDebounce:(NSTimeInterval *)lastEventTime interval:(NSTimeInterval)interval {
  NSTimeInterval now = [[NSDate date] timeIntervalSince1970];
  if (now - *lastEventTime < interval) {
    return YES;
  }
  *lastEventTime = now;
  return NO;
}

- (void)handleActivation {
  if ([self shouldDebounce:&_lastActivationTime interval:0.75]) {
    return;
  }

  if ([self runScriptNamed:@"focus-dev.sh"] == 0) {
    return;
  }

  if ([self runScriptNamed:@"dev-app-background.sh"] != 0) {
    return;
  }

  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    for (int attempt = 0; attempt < 45; attempt++) {
      if ([self runScriptNamed:@"focus-dev.sh"] == 0) {
        break;
      }
      [NSThread sleepForTimeInterval:1.0];
    }
  });
}

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
  if (![self loadConfig]) {
    [self showAlert:@"Project not found. Run npm run install:dev-shortcut from the repo again."];
    [NSApp terminate:nil];
    return;
  }

  [self handleActivation];

  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.5 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    self.readyForReopen = YES;
  });
}

- (BOOL)applicationShouldHandleReopen:(NSApplication *)sender hasVisibleWindows:(BOOL)flag {
  if (!self.readyForReopen) {
    return NO;
  }
  [self handleActivation];
  return NO;
}

- (NSMenu *)applicationDockMenu:(NSApplication *)sender {
  NSMenu *menu = [[NSMenu alloc] init];

  NSMenuItem *openTerminal = [[NSMenuItem alloc] initWithTitle:@"Open Terminal"
                                                        action:@selector(openTerminal:)
                                                 keyEquivalent:@""];
  openTerminal.target = self;
  [menu addItem:openTerminal];

  [menu addItem:[NSMenuItem separatorItem]];

  NSMenuItem *quitItem = [[NSMenuItem alloc] initWithTitle:@"Quit AI Companion Dev"
                                                    action:@selector(quitApp:)
                                             keyEquivalent:@""];
  quitItem.target = self;
  [menu addItem:quitItem];

  return menu;
}

- (void)openTerminal:(id)sender {
  if ([self shouldDebounce:&_lastOpenTerminalTime interval:1.0]) {
    return;
  }
  [self runScriptNamed:@"open-dev-terminal.sh"];
}

- (void)quitApp:(id)sender {
  [NSApp terminate:nil];
}

- (void)applicationWillTerminate:(NSNotification *)notification {
  [self runScriptNamed:@"stop-dev.sh"];
}

@end

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    NSApplication *app = [NSApplication sharedApplication];
    AppDelegate *delegate = [[AppDelegate alloc] init];
    app.delegate = delegate;
    [app setActivationPolicy:NSApplicationActivationPolicyRegular];
    [app run];
  }
  return 0;
}

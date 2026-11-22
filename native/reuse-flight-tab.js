// macOS JavaScript for Automation. Only inspect tab URLs in the default browser.
function route(address, target) {
  const parts = $.NSURLComponents.componentsWithString(address);
  if (!parts || ObjC.unwrap(parts.scheme) !== 'https' ||
      ObjC.unwrap(parts.host) !== 'sijipiao.fliggy.com' ||
      ObjC.unwrap(parts.path) !== '/ie/flight_search_result.htm') return 0;
  const fields = query(parts);
  const matches = key => fields[key] === target[key];
  if (!['depCity','arrCity','tripType'].every(matches)) return 0;
  return matches('depDate') && matches('arrDate') ? 2 : 1;
}

function query(parts) {
  const fields = {};
  const items = parts.queryItems;
  for (let i=0; i<Number(items.count); i++) {
    const item = items.objectAtIndex(i);
    fields[ObjC.unwrap(item.name)] = ObjC.unwrap(item.value);
  }
  return fields;
}

function run(args) {
  ObjC.import('AppKit');
  const url = args[0];
  const parts = $.NSURLComponents.componentsWithString(url);
  const target = query(parts);
  const appURL = $.NSWorkspace.sharedWorkspace.URLForApplicationToOpenURL(parts.URL);
  const id = ObjC.unwrap($.NSBundle.bundleWithURL(appURL).bundleIdentifier);
  const safari = id === 'com.apple.Safari';
  if (!safari && !['com.google.Chrome','com.microsoft.edgemac','com.brave.Browser'].includes(id)) return 'unsupported';
  const app = Application(id);
  if (!app.running()) return 'absent';
  let candidate;
  for (const window of app.windows()) {
    const tabs = window.tabs();
    for (let i = 0; i < tabs.length; i++) {
      const match = route(tabs[i].url(),target);
      if (match && (!candidate || match > candidate.match)) candidate={match,window,tab:tabs[i],index:i+1};
      if (match === 2) break;
    }
    if (candidate && candidate.match === 2) break;
  }
  if (!candidate) return 'absent';
  if (safari) candidate.window.currentTab = candidate.tab;
  else candidate.window.activeTabIndex = candidate.index;
  candidate.window.index = 1;
  if (candidate.match === 1) candidate.tab.url = url;
  app.activate();
  return candidate.match === 2 ? 'matched' : 'navigated';
}

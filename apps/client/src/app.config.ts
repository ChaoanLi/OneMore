export default defineAppConfig({
  pages: [
    'pages/index/index',
    'pages/event/detail',
    'pages/event/create',
    'pages/interest/create',
    'pages/ai/index',
    'pages/friends/index',
    'pages/friends/add',
    'pages/circle/edit',
    'pages/me/index',
    'pages/notifications/index',
    'pages/calendar/index',
  ],
  window: {
    backgroundTextStyle: 'light',
    backgroundColor: '#FFFFFF',
    navigationBarBackgroundColor: '#FFFFFF',
    navigationBarTitleText: '算我一个',
    navigationBarTextStyle: 'black',
  },
})

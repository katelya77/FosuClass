Page({
  data: {},

  goImportXls() {
    wx.redirectTo({
      url: "/pages/personal-sync/personal-sync?tab=xls",
    });
  },
});

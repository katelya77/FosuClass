const skill = wx.modelContext.createSkill('skills/fosu-campus');

skill.registerAPI('searchCampusSchedule', require('./apis/searchCampusSchedule'));
skill.registerAPI('findEmptyClassrooms', require('./apis/findEmptyClassrooms'));
skill.registerAPI('getTeachingWeek', require('./apis/getTeachingWeek'));
skill.registerAPI('openPersonalTask', require('./apis/openPersonalTask'));

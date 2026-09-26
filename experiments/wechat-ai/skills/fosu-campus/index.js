const skill = wx.modelContext.createSkill('skills/fosu-campus');

skill.registerAPI('searchCampusSchedule', require('./apis/searchCampusSchedule'));
skill.registerAPI('findEmptyClassrooms', require('./apis/findEmptyClassrooms'));
skill.registerAPI('getTeachingWeek', require('./apis/getTeachingWeek'));
skill.registerAPI('getTermCalendar', require('./apis/getTermCalendar'));
skill.registerAPI('getDataStatus', require('./apis/getDataStatus'));
skill.registerAPI('getCampusWeather', require('./apis/getCampusWeather'));
skill.registerAPI('searchCampusPlace', require('./apis/searchCampusPlace'));
skill.registerAPI('openPersonalTask', require('./apis/openPersonalTask'));
skill.registerAPI('openXiaoxuTask', require('./apis/openXiaoxuTask'));

namespace Center.Domain;

public record Actor(Guid Id, string Name, bool Platform, Guid Center, string[] Roles, Guid[] Units)
{
    public bool Admin => Roles.Contains("admin");
    public bool Teacher => Roles.Contains("teacher");
    public bool Manager => Roles.Contains("manager");
}
public record Account(Guid Id, string Name, string Email, string Password, bool Platform = false, bool Active = true, bool MustChangePassword = false,
    DateTimeOffset? TemporaryUntil = null, AuthenticatorDevice? Authenticator = null, AuthenticatorAttempts? AuthenticatorFailures = null);
public record AuthenticatorDevice(string ProtectedKey, long LastStep, string[] RecoveryHashes);
public record AuthenticatorAttempts(DateTimeOffset Until, int Count);
public record Membership(Guid Account, Guid Center, string[] Roles, Guid[] Units, bool Active = true);
public record Session(string Hash, Guid Account, DateTimeOffset Expires,
    string? Authenticator = null, string? PendingAuthenticatorKey = null);
public record Request(Guid Id, string Name, string Contact, string Email, string State, DateTimeOffset Created, string? Reason = null, Guid? Center = null);
public record CenterInfo(Guid Id, string Name, string TimeZone, bool Active = true, string? Logo = null, string? MapUrl = null);
public record Invite(string Hash, string Name, string Email, Guid Center, string[] Roles, Guid[] Units, DateTimeOffset Expires);
public record PasswordReset(Guid Account, string Hash, DateTimeOffset Expires);
public record Audit(DateTimeOffset At, Guid By, string Action, string Target, string? Reason = null);
public sealed class IdentityData
{
    public CatalogSettings? Catalog { get; set; }
    public bool DemoMapInitialized { get; set; }
    public List<PasswordReset> PasswordResets { get; init; } = [];
    public List<Account> Accounts { get; init; } = [];
    public List<Membership> Memberships { get; init; } = [];
    public List<Session> Sessions { get; init; } = [];
    public List<Request> Requests { get; init; } = [];
    public List<CenterInfo> Centers { get; init; } = [];
    public List<Invite> Invites { get; init; } = [];
    public List<Credential> Credentials { get; init; } = [];
    public List<Challenge> Challenges { get; init; } = [];
    public List<AndroidAttendanceKey> AndroidAttendanceKeys { get; init; } = [];
    public List<AndroidAttendanceChallenge> AndroidAttendanceChallenges { get; init; } = [];
    public List<Audit> Audit { get; init; } = [];
}
public record Credential(Guid Account, string Id, string Key, uint Counter);
public record Challenge(Guid Id, Guid Account, Guid Center, Guid? Meeting, string Options, DateTimeOffset Expires);
public record AndroidAttendanceKey(Guid Id, Guid Account, string PublicKey, string[] CertificateSerials);
public record AndroidAttendanceChallenge(Guid Id, Guid Account, Guid Center, Guid? Meeting, byte[] Value, DateTimeOffset Expires);

public record Unit(Guid Id, string Name, string Kind, Guid? Parent, bool Active = true);
public record UnitPlacement(Guid Unit, Guid? Parent, DateOnly Effective);
public record Period(Guid Id, string Name, DateOnly Start, DateOnly End);
public record Group(Guid Id, string Name, Guid? Unit, Guid Teacher, Guid? Period, DateOnly Start, DateOnly? End, DayOfWeek[] Days, TimeOnly From, TimeOnly To);
public record GroupHistory(Group Group, DateOnly Effective);
public record Student(Guid Id, string Number, string Name, DateOnly? Birth, string Contact, VerseSpan[] Baseline, string? Estimated);
public record Enrollment(Guid Student, Guid Group, DateOnly Start, DateOnly? End);
public record Rule(DateOnly Effective, int GroupLimit, bool CountExcused, int CloseHours, int OpenMinutes, int LateMinutes,
    double? Latitude, double? Longitude, int Radius, int Accuracy, Guid Version = default, bool AllowAttendanceReview = true);
public record Policy(string Text, DateOnly Effective);
public sealed class PeopleData
{
    public List<Unit> Units { get; init; } = [];
    public List<UnitPlacement> UnitPlacements { get; init; } = [];
    public List<Period> Periods { get; init; } = [];
    public List<Group> Groups { get; init; } = [];
    public List<GroupHistory> GroupHistory { get; init; } = [];
    public List<Student> Students { get; init; } = [];
    public long? LastStudentNumber { get; set; }
    public List<Enrollment> Enrollments { get; init; } = [];
    public List<Rule> Rules { get; init; } = [];
    public List<Policy> Policies { get; init; } = [];
    public Dictionary<Guid, Guid[]> Imports { get; init; } = [];
    public List<Audit> Audit { get; init; } = [];
}
public record VerseSpan(int Surah, int From, int To);
public record Reading(VerseSpan Span, string Kind, string Result);
public record Mark(Guid Student, string? Status, string? Practice, Reading[] Readings, string? Note);
public record Meeting(Guid Id, Guid? Group, Guid? Course, DateOnly Date, TimeOnly From, TimeOnly To, string Kind, string State,
    Guid AttendanceBy, Guid LessonBy, Guid PracticeBy, Guid[] Teachers, Guid[] Roster, string Lesson, Mark[] Marks, int Version, Guid? Unit,
    Guid? LessonCourse = null, Guid? Replaces = null, Guid RuleVersion = default);
public record Course(Guid Id, string Name, string Type, string? Level, Guid Owner, Guid[] Teachers, Guid[] Groups, Guid[] Students,
    string Status, Guid? Commission, string Criterion = "manual", CourseCurriculum? Curriculum = null);
public record CourseTeacherRequest(Guid Id, Guid Course, Guid RequestedBy, Guid[] Teachers, DateTimeOffset SubmittedAt);
public record Notice(Guid Id, Guid Recipient, string Text, string Route, DateTimeOffset CreatedAt, bool Read = false);
public record Commission(Guid Id, string Title, Guid Teacher, Guid[] Groups, string State);
public record Grade(Guid Course, Guid Student, string State, DateOnly Date, Guid By);
public record FollowUp(Guid Id, Guid Student, Guid Group, string Text, DateOnly Due, bool Done, Guid By);
public record Category(Guid Id, string Name, Guid? Unit, int? MinAge, int? MaxAge);
public record Competition(Guid Id, string Name, DateOnly Date, bool Multiple, Category[] Categories);
public record ContestEntry(Guid Competition, Guid Category, Guid Student, decimal? Score, int? Rank);
public record MeetingSettings(string[] Levels, MeetingType[] Types);
public record MeetingType(string Key, string Name, bool Lesson, bool Practice);
public sealed class EducationData
{
    public List<Meeting> Meetings { get; init; } = [];
    public List<Course> Courses { get; init; } = [];
    public List<CourseChoice> MemorizationChoices { get; init; } = [];
    public List<CourseTeacherRequest> CourseTeacherRequests { get; init; } = [];
    public List<Notice> Notifications { get; init; } = [];
    public List<Commission> Commissions { get; init; } = [];
    public List<Grade> Grades { get; init; } = [];
    public List<FollowUp> FollowUps { get; init; } = [];
    public List<Competition> Competitions { get; init; } = [];
    public List<ContestEntry> Entries { get; init; } = [];
    public List<Audit> Audit { get; init; } = [];
    public MeetingSettings? Settings { get; set; }
}
public record StaffShift(Guid Employee, DateOnly Effective, DayOfWeek[] Days, TimeOnly From, TimeOnly To, bool Active);
public record CheckIn(Guid Meeting, Guid Teacher, string State, DateTimeOffset At, string Source, string? Reason, double? Accuracy);
public record TaskItem(Guid Id, Guid Teacher, string Title, string Detail, DateOnly Due, Guid? Group, Guid? Course, string State, string? Reply);
public sealed class WorkData
{
    public List<CheckIn> CheckIns { get; init; } = [];
    public List<StaffShift> Shifts { get; init; } = [];
    public List<TaskItem> Tasks { get; init; } = [];
    public List<Audit> Audit { get; init; } = [];
}

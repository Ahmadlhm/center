import { useEffect, useState } from "react";
import { Bell, ChevronLeft } from "lucide-react";
import { api, base, date, go, message, type Center } from "./model";
import { Dialog, Empty, ErrorBox } from "./ui";

type Notice = {
  id: string;
  text: string;
  route: string;
  createdAt: string;
  read: boolean;
};
type Inbox = { unread: number; items: Notice[] };

export function InboxButton({
  center,
  refresh,
}: {
  center: Center;
  refresh: () => Promise<void>;
}) {
  const path = base(center) + "/education/notifications";
  const [inbox, setInbox] = useState<Inbox>({ unread: 0, items: [] });
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function poll() {
      try {
        const result = await api<Inbox>(path);
        if (active) {
          setInbox(result);
          setError("");
        }
      } catch (error) {
        if (active) setError(message(error));
      }
    }
    void poll();
    const timer = setInterval(() => void poll(), 30_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [path]);

  async function load() {
    try {
      setInbox(await api<Inbox>(path));
      setError("");
    } catch (error) {
      setError(message(error));
    }
  }

  async function visit(item: Notice) {
    try {
      if (!item.read) await api(path + "/" + item.id + "/read", "PUT");
      setOpen(false);
      go(item.route);
      await Promise.all([load(), refresh()]);
    } catch (error) {
      setError(message(error));
    }
  }

  return (
    <>
      <button
        type="button"
        className="icon-button notice-bell"
        aria-label={
          inbox.unread
            ? "الإشعارات (" + inbox.unread + " غير مقروءة)"
            : "الإشعارات"
        }
        onClick={() => {
          setOpen(true);
          void load();
        }}
      >
        <Bell size={20} />
        {inbox.unread > 0 && (
          <span aria-hidden="true">
            {inbox.unread > 99 ? "99+" : inbox.unread}
          </span>
        )}
      </button>
      {open && (
        <Dialog title="الإشعارات" close={() => setOpen(false)}>
          {error && <ErrorBox>{error}</ErrorBox>}
          {inbox.items.length ? (
            <ul className="inbox-list">
              {inbox.items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={item.read ? "" : "unread"}
                    onClick={() => void visit(item)}
                  >
                    <span>
                      {item.text}
                      <small>{date(item.createdAt.slice(0, 10))}</small>
                    </span>
                    <ChevronLeft size={16} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="لا توجد إشعارات بعد" />
          )}
        </Dialog>
      )}
    </>
  );
}

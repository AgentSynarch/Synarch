import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-white" style={{ fontFamily: "'Inter', sans-serif" }}>
      <div className="text-center">
        <h1 className="text-6xl font-serif font-normal text-neutral-900 mb-4">404</h1>
        <p className="text-lg text-neutral-400 mb-8">Page not found</p>
        <Link to="/" className="bg-neutral-900 hover:bg-neutral-700 text-white px-7 py-3 rounded-full text-sm font-medium transition-colors">
          Return Home
        </Link>
      </div>
    </div>
  );
};

export default NotFound;

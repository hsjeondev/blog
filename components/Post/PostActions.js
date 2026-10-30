import { motion } from 'framer-motion';
import IonIcon from "../Icon";

const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0 }
};

export const PostActions = ({ title, pageId }) => {
    const handleShare = async () => {
        try {
            await navigator.share({
                title: "프리머그의 Blog",
                text: title + " - 프리머그의 Blog",
                url: window.location.href,
            });
        } catch (error) {
            console.error("공유에 실패하였습니다", error);
            try {
                await navigator.clipboard.writeText(window.location.href);
                // Optional: Toast notification or alert could be added here
                alert("링크가 복사되었습니다!");
            } catch (err) {
                console.error("복사에 실패하였습니다", error);
            }
        }
    };

    return (
        <motion.div variants={itemVariants}>
            <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="mt-3 px-4 py-2 text-sm rounded-xl hover:bg-blue-600 transition-colors"
                style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)' }}
                type="button"
                onClick={handleShare}
            >
                <IonIcon name='share-social-outline' className='relative top-[3px] mr-2' />공유하기
            </motion.button>
        </motion.div>
    );
};

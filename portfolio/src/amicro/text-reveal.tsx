// From Amicro (https://amicro.dev), MIT License, see ./LICENSE. Local change: reveals play on mount, not on scroll into view.
import React from 'react';
import { motion } from 'framer-motion';

interface TextRevealProps {
  text: string;
  duration?: number;
  staggerDelay?: number;
  className?: string;
}

export function TextReveal({
  text,
  duration = 0.8,
  staggerDelay = 0.15,
  className = '',
}: TextRevealProps) {
  const lines = text.split('\n');

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: staggerDelay,
      },
    },
  };

  const itemVariants = {
    hidden: { y: '100%' },
    visible: {
      y: 0,
      transition: {
        duration,
        ease: [0.16, 1, 0.3, 1] as const, // easeOutExpo
      },
    },
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className={`flex flex-col ${className}`}
    >
      {lines.map((line, index) => (
        <div key={index} className="overflow-hidden py-1">
          <motion.span variants={itemVariants} className="block">
            {line}
          </motion.span>
        </div>
      ))}
    </motion.div>
  );
}
